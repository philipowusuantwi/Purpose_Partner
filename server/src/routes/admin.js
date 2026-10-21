import { transaction, parseJson } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { eventValues } from './churches.js';

const ROLES = ['member', 'moderator', 'trust_analyst', 'admin'];

export default function adminRoutes(app, ctx) {
  const { db, config, authBasic, requireRole, trust, notifier, audit } = ctx;
  const admin = [authBasic, requireRole('admin')];

  /** KPIs for the impact dashboard. */
  app.get('/api/admin/stats', ...admin, (_req, res) => {
    const n = (sql, ...p) => db.prepare(sql).get(...p).n;
    const profiles = db.prepare("SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active'").all();
    const badges = profiles.map((p) => trust.badge(p.user_id));
    const tiers = {};
    for (const b of badges) tiers[b.tier] = (tiers[b.tier] ?? 0) + 1;
    res.json({
      members: n('SELECT COUNT(*) AS n FROM users'),
      newThisWeek: n("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-7 days')"),
      activeThisWeek: n("SELECT COUNT(*) AS n FROM users WHERE last_active_at > datetime('now', '-7 days')"),
      profiles: profiles.length,
      identityVerified: badges.filter((b) => b.identityVerified).length,
      shieldHolders: badges.filter((b) => b.shield).length,
      tiers,
      matches: n('SELECT COUNT(*) AS n FROM matches'),
      inCourtship: n("SELECT COUNT(*) AS n FROM matches WHERE status = 'active' AND stage != 'getting_to_know'"),
      engaged: n("SELECT COUNT(*) AS n FROM matches WHERE stage = 'engaged'"),
      messagesThisWeek: n("SELECT COUNT(*) AS n FROM messages WHERE created_at > datetime('now', '-7 days')"),
      flaggedMessages: n("SELECT COUNT(*) AS n FROM messages WHERE risk = 'high'"),
      openReports: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      suspended: n("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"),
      churches: n("SELECT COUNT(*) AS n FROM churches WHERE status = 'approved'"),
      pendingChurches: n("SELECT COUNT(*) AS n FROM churches WHERE status = 'pending'"),
      premium: n('SELECT COUNT(*) AS n FROM subscriptions WHERE current_period_end > ?', new Date().toISOString()),
    });
  });

  app.get('/api/admin/users', ...admin, (req, res) => {
    const term = `%${String(req.query.q ?? '').trim().toLowerCase().slice(0, 100)}%`;
    res.json({
      users: db.prepare(`SELECT u.id, u.email, u.role, u.status, u.created_at, p.first_name FROM users u LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.email LIKE ? OR LOWER(COALESCE(p.first_name, '')) LIKE ? ORDER BY u.id DESC LIMIT 50`).all(term, term),
    });
  });

  app.put('/api/admin/users/:id/role', ...admin, (req, res) => {
    const id = Number(req.params.id);
    if (!ROLES.includes(req.body?.role)) throw badRequest('Unknown role.');
    if (id === req.user.id) throw badRequest('You cannot change your own role.');
    const r = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
    if (!r.changes) throw notFound();
    audit(req.user.id, 'user.role', 'user', id, { role: req.body.role });
    res.json({ role: req.body.role });
  });

  /** Pilot mode only: a password-reset link an admin can pass on (before email is connected). */
  app.post('/api/admin/users/:id/reset-link', ...admin, (req, res) => {
    if (!config().pilot) throw badRequest('Reset links are only available in pilot mode.');
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound();
    audit(req.user.id, 'user.reset_link', 'user', id);
    res.json({ link: `${config().appUrl}/#/reset-password?token=${ctx.createAuthToken(id, 'reset', 60 * 24)}` });
  });

  app.get('/api/admin/churches', ...admin, (_req, res) => {
    res.json({
      churches: db.prepare(`SELECT c.*, u.email AS applicant_email,
          (SELECT COUNT(*) FROM church_memberships WHERE church_id = c.id AND status = 'confirmed') AS members
        FROM churches c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.status = 'pending' DESC, c.created_at DESC LIMIT 200`).all(),
    });
  });

  /** Approve a church after due diligence (e.g. registration and a call with leadership). */
  app.post('/api/admin/churches/:id', ...admin, (req, res) => {
    const c = db.prepare('SELECT * FROM churches WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound();
    if (!['approve', 'reject'].includes(req.body?.decision)) throw badRequest('Choose approve or reject.');
    const status = req.body.decision === 'approve' ? 'approved' : 'rejected';
    transaction(db, () => {
      db.prepare('UPDATE churches SET status = ? WHERE id = ?').run(status, c.id);
      audit(req.user.id, `church.${req.body.decision}`, 'church', c.id);
    });
    notifier.notify(c.created_by, { type: 'church', title: status === 'approved' ? `${c.name} is now a partner church` : `${c.name} was not approved`, link: status === 'approved' ? `#/church/${c.id}` : '#/me' });
    res.json({ status });
  });

  app.post('/api/admin/events', ...admin, (req, res) => {
    const v = eventValues(req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO events (created_by, title, description, starts_at, venue, city, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, v.title, v.description, v.startsAt, v.venue, v.city, v.capacity);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.get('/api/admin/audit', ...admin, (_req, res) => {
    res.json({
      entries: db.prepare('SELECT a.*, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200').all()
        .map((e) => ({ ...e, detail: parseJson(e.detail, null) })),
    });
  });
}
