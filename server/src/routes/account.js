import { verifyPassword } from '../auth.js';
import { transaction, parseJson } from '../db.js';
import { DOCUMENTS, REVIEW_STATUS } from '../content/legal.js';
import { decrypt, blindIndex } from '../services/secure.js';
import { badRequest, notFound } from '../errors.js';
import { text } from '../validation.js';

/** Remember a removed member's identifiers (as keyed hashes only) to stop ban evasion. */
export function banIdentities(db, user) {
  const add = db.prepare('INSERT OR IGNORE INTO banned_identities (kind, value_index) VALUES (?, ?)');
  add.run('email', blindIndex(user.email));
  if (user.phone_index && user.phone_verified) add.run('phone', user.phone_index);
  for (const v of db.prepare("SELECT doc_index FROM verifications WHERE user_id = ? AND kind = 'ghana_card' AND doc_index IS NOT NULL").all(user.id)) {
    add.run('ghana_card', v.doc_index);
  }
}

export const isBanned = (db, kind, index) => Boolean(db.prepare('SELECT 1 FROM banned_identities WHERE kind = ? AND value_index = ?').get(kind, index));

const safeDecrypt = (v) => { try { return v ? decrypt(v) : null; } catch { return null; } };

export default function accountRoutes(app, ctx) {
  const { db, auth, authBasic, authSuspended, members, notifier } = ctx;

  app.get('/api/legal', (_req, res) => {
    res.json({ status: REVIEW_STATUS, documents: Object.entries(DOCUMENTS).map(([id, d]) => ({ id, title: d.title, version: d.version })) });
  });

  app.get('/api/legal/:doc', (req, res) => {
    const d = DOCUMENTS[req.params.doc];
    if (!d) throw notFound();
    res.json({ id: req.params.doc, title: d.title, version: d.version, body: d.body, status: REVIEW_STATUS });
  });

  /** Accept the current version of the listed documents (used after a terms update). */
  app.post('/api/consents/accept', authBasic, (req, res) => {
    const docs = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (!docs.length || docs.some((d) => !DOCUMENTS[d])) throw badRequest('Unknown document.');
    const record = db.prepare('INSERT INTO consents (user_id, document, version) VALUES (?, ?, ?)');
    transaction(db, () => { for (const d of docs) record.run(req.user.id, d, DOCUMENTS[d].version); });
    res.json(members.me(req.user));
  });

  app.get('/api/consents', authBasic, (req, res) => {
    res.json({ history: db.prepare('SELECT document, version, action, created_at FROM consents WHERE user_id = ? ORDER BY id DESC').all(req.user.id) });
  });

  /** Pause or resume appearing in Discover. */
  app.put('/api/account/visibility', auth, (req, res) => {
    db.prepare('UPDATE profiles SET visible = ? WHERE user_id = ?').run(req.body?.visible ? 1 : 0, req.user.id);
    res.json(members.me(req.user));
  });

  /** Right of access: everything we hold about the member, as JSON. */
  app.get('/api/account/export', authSuspended, (req, res) => {
    const id = req.user.id;
    const all = (sql) => db.prepare(sql).all(id);
    const u = req.user;
    res.json({
      exportedAt: new Date().toISOString(),
      account: { email: u.email, phone: safeDecrypt(u.phone_enc), emailVerified: Boolean(u.email_verified), phoneVerified: Boolean(u.phone_verified), role: u.role, status: u.status, createdAt: u.created_at },
      profile: members.profile(id) ?? null,
      photos: all('SELECT id, status, created_at FROM photos WHERE user_id = ?'),
      relationshipStatus: db.prepare('SELECT status, declared_at FROM status_declarations WHERE user_id = ?').get(id) ?? null,
      verifications: all('SELECT kind, status, meta, reason, created_at, reviewed_at FROM verifications WHERE user_id = ?').map((v) => ({ ...v, meta: parseJson(v.meta, {}) })),
      church: db.prepare('SELECT c.name, m.status, m.member_since, m.ministry, m.created_at FROM church_memberships m JOIN churches c ON c.id = m.church_id WHERE m.user_id = ?').get(id) ?? null,
      references: all('SELECT name, relationship, status, created_at, responded_at FROM references_ WHERE user_id = ?'),
      readiness: all('SELECT scores, created_at FROM readiness_results WHERE user_id = ?').map((r) => ({ ...r, scores: parseJson(r.scores, null) })),
      interests: all('SELECT to_id, kind, note, created_at FROM interests WHERE from_id = ?'),
      matches: db.prepare('SELECT id, user_a, user_b, status, stage, created_at FROM matches WHERE user_a = ? OR user_b = ?').all(id, id),
      messagesSent: all('SELECT match_id, body, created_at FROM messages WHERE sender_id = ?'),
      reportsMade: all('SELECT reported_id, reason, details, status, created_at FROM reports WHERE reporter_id = ?'),
      safetyPlans: all('SELECT place, starts_at, contact_name, status, created_at FROM safety_plans WHERE user_id = ?'),
      eventRsvps: all('SELECT event_id, created_at FROM event_rsvps WHERE user_id = ?'),
      consents: all('SELECT document, version, action, created_at FROM consents WHERE user_id = ?'),
      payments: all('SELECT plan, amount_minor, currency, status, created_at FROM payments WHERE user_id = ?'),
    });
  });

  /**
   * Right to erasure. Cascades remove the profile, photos, verifications, references, matches
   * and conversations; messages they sent are deleted explicitly.
   */
  app.delete('/api/account', authSuspended, (req, res) => {
    if (!verifyPassword(String(req.body?.password ?? ''), req.user.password_hash)) throw badRequest('Your password is incorrect.');
    transaction(db, () => {
      const upheld = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reported_id = ? AND status = 'upheld'").get(req.user.id).n;
      if (upheld || req.user.status === 'suspended') banIdentities(db, req.user);
      db.prepare('DELETE FROM messages WHERE sender_id = ?').run(req.user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    });
    res.status(204).end();
  });

  // Appeals: available to suspended members.
  app.get('/api/appeals', authSuspended, (req, res) => {
    res.json({ appeals: db.prepare('SELECT id, body, status, decision, created_at, decided_at FROM appeals WHERE user_id = ? ORDER BY id DESC').all(req.user.id) });
  });

  app.post('/api/appeals', authSuspended, (req, res) => {
    if (req.user.status !== 'suspended') throw badRequest('Your account is not suspended.');
    const body = text(req.body?.body, 2000);
    if (!body || body.length < 20) throw badRequest('Please explain your appeal in at least 20 characters.');
    if (db.prepare("SELECT 1 FROM appeals WHERE user_id = ? AND status = 'open'").get(req.user.id)) throw badRequest('You already have an appeal under review.');
    db.prepare('INSERT INTO appeals (user_id, body) VALUES (?, ?)').run(req.user.id, body);
    res.status(201).json({ submitted: true });
  });

  // Notifications
  app.get('/api/notifications', authBasic, (req, res) => {
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    res.json({ items, unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n });
  });

  app.post('/api/notifications/read', authBasic, (req, res) => {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
    res.status(204).end();
  });

  ctx.notifyStaff = (title, body, link) => {
    for (const s of db.prepare("SELECT id FROM users WHERE role IN ('moderator', 'trust_analyst', 'admin') AND status = 'active'").all()) {
      notifier.notify(s.id, { type: 'staff', title, body, link });
    }
  };
}
