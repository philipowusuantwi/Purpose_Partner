import { transaction, parseJson } from '../db.js';
import { STAFF_ROLES } from '../auth.js';
import { REPORT_REASONS } from '../content/lists.js';
import { badRequest, notFound } from '../errors.js';
import { text } from '../validation.js';

// Trust & Safety console. Implements the fraud escalation SOP:
//   Detection -> Risk scoring -> Human review -> Suspension -> Appeals -> Resolution
// Moderators handle photos, reports and appeals. Identity documents and risk flags are
// restricted to trust analysts and admins.

const KIND_LABELS = { ghana_card: 'Ghana Card', liveness: 'Liveness selfie', status_evidence: 'Relationship status evidence' };

export default function staffRoutes(app, ctx) {
  const { db, authBasic, requireRole, members, trust, notifier, audit } = ctx;
  const staff = [authBasic, requireRole(...STAFF_ROLES)];
  const analyst = [authBasic, requireRole('trust_analyst', 'admin')];

  const who = (userId) => {
    const c = members.card(userId);
    const u = db.prepare('SELECT id, email, status, created_at FROM users WHERE id = ?').get(userId);
    return u && { id: u.id, firstName: c?.firstName ?? '(no profile)', age: c?.age, city: c?.city, status: u.status, joined: u.created_at, photos: c?.photos ?? [], trust: c ? trust.badge(userId) : null };
  };

  function suspend(actorId, userId, reason) {
    db.prepare("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?").run(reason, userId);
    db.prepare("UPDATE matches SET status = 'closed', closed_at = datetime('now') WHERE (user_a = ? OR user_b = ?) AND status = 'active'").run(userId, userId);
    audit(actorId, 'user.suspend', 'user', userId, { reason });
    notifier.notify(userId, { type: 'account', title: 'Your account has been suspended', body: reason, link: '#/' });
  }

  function reinstate(actorId, userId) {
    db.prepare("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?").run(userId);
    db.prepare("UPDATE profiles SET hidden_reason = NULL WHERE user_id = ?").run(userId);
    audit(actorId, 'user.reinstate', 'user', userId);
    notifier.notify(userId, { type: 'account', title: 'Your account has been reinstated', body: 'Thank you for your patience.', link: '#/' });
  }

  const decision = (req, allowed) => {
    const d = req.body?.decision;
    if (!allowed.includes(d)) throw badRequest(`Decision must be one of: ${allowed.join(', ')}.`);
    return d;
  };

  app.get('/api/staff/overview', ...staff, (req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    res.json({
      role: req.user.role,
      queues: {
        verifications: n("SELECT COUNT(*) AS n FROM verifications WHERE status = 'pending'"),
        photos: n("SELECT COUNT(*) AS n FROM photos WHERE status = 'pending'"),
        reports: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
        flags: n("SELECT COUNT(*) AS n FROM risk_flags WHERE status = 'open'"),
        appeals: n("SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'"),
      },
    });
  });

  // ---- Verifications ------------------------------------------------------
  app.get('/api/staff/verifications', ...analyst, (_req, res) => {
    const rows = db.prepare("SELECT id, user_id, kind, meta, created_at FROM verifications WHERE status = 'pending' ORDER BY created_at LIMIT 100").all();
    res.json({ items: rows.map((v) => ({ id: v.id, kind: v.kind, kindLabel: KIND_LABELS[v.kind], meta: parseJson(v.meta, {}), createdAt: v.created_at, member: who(v.user_id) })) });
  });

  app.get('/api/staff/verifications/:id', ...analyst, (req, res) => {
    const v = db.prepare('SELECT * FROM verifications WHERE id = ?').get(Number(req.params.id));
    if (!v) throw notFound();
    audit(req.user.id, 'verification.view', 'verification', v.id);
    const flags = db.prepare("SELECT detail, level, created_at FROM risk_flags WHERE user_id = ? AND status = 'open'").all(v.user_id);
    const profile = members.profile(v.user_id);
    res.json({
      id: v.id, kind: v.kind, kindLabel: KIND_LABELS[v.kind], status: v.status, meta: parseJson(v.meta, {}), createdAt: v.created_at,
      submission: ctx.readSubmission(v),
      member: { ...who(v.user_id), firstName: profile?.first_name, birthDate: profile?.birth_date, gender: profile?.gender },
      flags,
    });
  });

  app.post('/api/staff/verifications/:id', ...analyst, (req, res) => {
    const v = db.prepare("SELECT * FROM verifications WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
    if (!v) throw notFound('This verification is no longer pending.');
    const d = decision(req, ['approve', 'reject']);
    const reason = text(req.body?.reason, 300);
    if (d === 'reject' && !reason) throw badRequest('Please give the member a reason so they can try again.');
    if (d === 'approve' && v.kind === 'ghana_card'
      && db.prepare("SELECT 1 FROM verifications WHERE kind = 'ghana_card' AND status = 'approved' AND doc_index = ? AND user_id != ?").get(v.doc_index, v.user_id)) {
      return res.status(409).json({ error: 'This Ghana Card is already verified on another account. Reject and investigate.' });
    }
    transaction(db, () => {
      // Data minimisation: the images are erased once a decision is made.
      db.prepare("UPDATE verifications SET status = ?, reason = ?, reviewed_by = ?, reviewed_at = datetime('now'), payload_enc = NULL WHERE id = ?")
        .run(d === 'approve' ? 'approved' : 'rejected', reason, req.user.id, v.id);
      audit(req.user.id, `verification.${d}`, 'verification', v.id, { kind: v.kind, userId: v.user_id });
    });
    notifier.notify(v.user_id, {
      type: 'verification',
      title: d === 'approve' ? `${KIND_LABELS[v.kind]} verified ✓` : `${KIND_LABELS[v.kind]} could not be verified`,
      body: reason, link: '#/trust',
    });
    res.json({ status: d === 'approve' ? 'approved' : 'rejected' });
  });

  // ---- Photos ---------------------------------------------------------------
  app.get('/api/staff/photos', ...staff, (_req, res) => {
    const rows = db.prepare("SELECT id, user_id, data, created_at FROM photos WHERE status = 'pending' ORDER BY id LIMIT 60").all();
    res.json({ items: rows.map((p) => ({ id: p.id, data: p.data, createdAt: p.created_at, member: who(p.user_id) })) });
  });

  app.post('/api/staff/photos/:id', ...staff, (req, res) => {
    const p = db.prepare("SELECT * FROM photos WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
    if (!p) throw notFound('This photo is no longer pending.');
    const d = decision(req, ['approve', 'reject']);
    const reason = text(req.body?.reason, 200);
    db.prepare('UPDATE photos SET status = ?, reason = ?, reviewed_by = ? WHERE id = ?').run(d === 'approve' ? 'approved' : 'rejected', reason, req.user.id, p.id);
    audit(req.user.id, `photo.${d}`, 'photo', p.id, { userId: p.user_id });
    if (d === 'reject') notifier.notify(p.user_id, { type: 'photo', title: 'A photo was not approved', body: reason ?? 'Photos must clearly show only you.', link: '#/profile' });
    res.json({ status: d === 'approve' ? 'approved' : 'rejected' });
  });

  // ---- Reports --------------------------------------------------------------
  app.get('/api/staff/reports', ...staff, (_req, res) => {
    const rows = db.prepare(`SELECT r.*, m.body AS message_body,
        (SELECT COUNT(*) FROM reports x WHERE x.reported_id = r.reported_id) AS total_reports
      FROM reports r LEFT JOIN messages m ON m.id = r.message_id WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100`).all();
    res.json({
      items: rows.map((r) => ({
        id: r.id, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason], details: r.details, message: r.message_body,
        createdAt: r.created_at, reporterId: r.reporter_id, totalReports: r.total_reports, member: who(r.reported_id),
      })),
    });
  });

  app.post('/api/staff/reports/:id', ...staff, (req, res) => {
    const r = db.prepare("SELECT * FROM reports WHERE id = ? AND status = 'open'").get(Number(req.params.id));
    if (!r) throw notFound('This report is no longer open.');
    const d = decision(req, ['uphold', 'dismiss']);
    const resolution = text(req.body?.resolution, 500);
    transaction(db, () => {
      db.prepare("UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
        .run(d === 'uphold' ? 'upheld' : 'dismissed', resolution, req.user.id, r.id);
      audit(req.user.id, `report.${d}`, 'report', r.id, { userId: r.reported_id });
      if (d === 'uphold' && req.body?.suspend) suspend(req.user.id, r.reported_id, resolution || 'Your account broke our Community Guidelines.');
      const open = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reported_id = ? AND status = 'open'").get(r.reported_id).n;
      if (!open && d === 'dismiss') db.prepare("UPDATE profiles SET hidden_reason = NULL WHERE user_id = ? AND hidden_reason = 'reports'").run(r.reported_id);
    });
    if (r.reporter_id) notifier.notify(r.reporter_id, { type: 'report', title: 'We reviewed your report', body: 'Thank you for helping keep Purpose Partner safe.' });
    res.json({ status: d === 'uphold' ? 'upheld' : 'dismissed' });
  });

  // ---- Risk flags -----------------------------------------------------------
  app.get('/api/staff/flags', ...analyst, (_req, res) => {
    const rows = db.prepare("SELECT * FROM risk_flags WHERE status = 'open' ORDER BY level = 'high' DESC, created_at LIMIT 100").all();
    res.json({
      items: rows.map((f) => ({
        id: f.id, source: f.source, level: f.level, detail: f.detail, createdAt: f.created_at, member: who(f.user_id),
        message: f.source === 'message' ? db.prepare('SELECT body FROM messages WHERE id = ?').get(Number(f.ref))?.body ?? null : null,
      })),
    });
  });

  app.post('/api/staff/flags/:id', ...analyst, (req, res) => {
    const f = db.prepare("SELECT * FROM risk_flags WHERE id = ? AND status = 'open'").get(Number(req.params.id));
    if (!f) throw notFound('This flag is no longer open.');
    const d = decision(req, ['confirm', 'dismiss']);
    transaction(db, () => {
      db.prepare('UPDATE risk_flags SET status = ?, reviewed_by = ? WHERE id = ?').run(d === 'confirm' ? 'confirmed' : 'dismissed', req.user.id, f.id);
      audit(req.user.id, `flag.${d}`, 'risk_flag', f.id, { userId: f.user_id });
      if (d === 'confirm' && req.body?.suspend) suspend(req.user.id, f.user_id, text(req.body?.reason, 300) || 'Our safety team found activity that breaks our guidelines.');
    });
    res.json({ status: d === 'confirm' ? 'confirmed' : 'dismissed' });
  });

  // ---- Appeals --------------------------------------------------------------
  app.get('/api/staff/appeals', ...staff, (_req, res) => {
    const rows = db.prepare(`SELECT a.*, u.suspended_reason FROM appeals a JOIN users u ON u.id = a.user_id WHERE a.status = 'open' ORDER BY a.created_at`).all();
    res.json({ items: rows.map((a) => ({ id: a.id, body: a.body, suspendedReason: a.suspended_reason, createdAt: a.created_at, member: who(a.user_id) })) });
  });

  app.post('/api/staff/appeals/:id', ...staff, (req, res) => {
    const a = db.prepare("SELECT * FROM appeals WHERE id = ? AND status = 'open'").get(Number(req.params.id));
    if (!a) throw notFound('This appeal is no longer open.');
    const d = decision(req, ['reinstate', 'deny']);
    const note = text(req.body?.note, 500);
    transaction(db, () => {
      db.prepare("UPDATE appeals SET status = ?, decision = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
        .run(d === 'reinstate' ? 'reinstated' : 'denied', note, req.user.id, a.id);
      audit(req.user.id, `appeal.${d}`, 'appeal', a.id, { userId: a.user_id });
      if (d === 'reinstate') reinstate(req.user.id, a.user_id);
      else notifier.notify(a.user_id, { type: 'account', title: 'Your appeal was reviewed', body: note ?? 'The suspension remains in place.' });
    });
    res.json({ status: d === 'reinstate' ? 'reinstated' : 'denied' });
  });

  // ---- Investigations -------------------------------------------------------
  app.get('/api/staff/users/:id', ...staff, (req, res) => {
    const id = Number(req.params.id);
    const m = who(id);
    if (!m) throw notFound();
    audit(req.user.id, 'user.investigate', 'user', id);
    res.json({
      member: m,
      suspendedReason: db.prepare('SELECT suspended_reason FROM users WHERE id = ?').get(id).suspended_reason,
      trust: members.profile(id) ? trust.report(id) : null,
      reports: db.prepare('SELECT id, reason, details, status, resolution, created_at FROM reports WHERE reported_id = ? ORDER BY id DESC').all(id),
      flags: db.prepare('SELECT id, source, level, detail, status, created_at FROM risk_flags WHERE user_id = ? ORDER BY id DESC').all(id),
      verifications: db.prepare('SELECT id, kind, status, reason, created_at, reviewed_at FROM verifications WHERE user_id = ? ORDER BY id DESC').all(id),
    });
  });

  app.post('/api/staff/users/:id/suspend', ...staff, (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw notFound();
    if (STAFF_ROLES.includes(u.role)) throw badRequest('Staff accounts cannot be suspended here.');
    const reason = text(req.body?.reason, 300);
    if (!reason) throw badRequest('Please give a reason.');
    suspend(req.user.id, id, reason);
    res.json({ status: 'suspended' });
  });

  app.post('/api/staff/users/:id/reinstate', ...staff, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound();
    reinstate(req.user.id, id);
    res.json({ status: 'active' });
  });
}
