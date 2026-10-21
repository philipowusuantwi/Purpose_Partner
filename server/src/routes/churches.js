import { transaction } from '../db.js';
import { DENOMINATIONS, REGIONS } from '../content/lists.js';
import { ageOn } from '../engines/matching.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { text } from '../validation.js';

const ATTESTATIONS = ['confirms_single', 'cannot_confirm', 'not_single'];

/** Validates an event body; returns values or throws. Shared with the admin module. */
export function eventValues(b = {}) {
  const title = text(b.title, 120);
  const venue = text(b.venue, 200);
  const startsAt = typeof b.startsAt === 'string' && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt).toISOString() : null;
  if (!title || !venue || !startsAt) throw badRequest('Please give a title, venue, date and time.');
  if (startsAt < new Date().toISOString()) throw badRequest('Events must be in the future.');
  const capacity = b.capacity === undefined || b.capacity === null || b.capacity === '' ? null : Number(b.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000)) throw badRequest('Capacity must be a whole number.');
  return { title, venue, startsAt, capacity, description: text(b.description, 2000), city: text(b.city, 60) };
}

export default function churchRoutes(app, ctx) {
  const { db, auth, member, notifier, audit } = ctx;

  const adminOf = db.prepare(`SELECT c.*, a.title FROM church_admins a JOIN churches c ON c.id = a.church_id WHERE a.user_id = ? AND a.church_id = ?`);
  /** The approved church the signed-in user administers, or 403. */
  function myChurch(req) {
    const c = adminOf.get(req.user.id, Number(req.params.churchId));
    if (!c) throw forbidden('You are not an admin of this church.');
    if (c.status !== 'approved') throw forbidden('This church is waiting for approval.');
    return c;
  }

  app.get('/api/churches', auth, (req, res) => {
    const term = `%${String(req.query.q ?? '').trim().slice(0, 60)}%`;
    res.json({
      churches: db.prepare(`SELECT id, name, denomination, city, region FROM churches WHERE status = 'approved'
        AND (name LIKE ? OR city LIKE ?) ORDER BY name LIMIT 50`).all(term, term),
    });
  });

  /** Register a church for the partner programme. The applicant becomes its first admin. */
  app.post('/api/churches', ...member, (req, res) => {
    const b = req.body ?? {};
    const name = text(b.name, 120);
    const city = text(b.city, 60);
    if (!name || !city) throw badRequest('Please give the church name and city.');
    if (!DENOMINATIONS.includes(b.denomination)) throw badRequest('Please choose a denomination.');
    if (b.region && !REGIONS.includes(b.region)) throw badRequest('Please choose a valid region.');
    const id = transaction(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO churches (name, denomination, region, city, address, phone, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, b.denomination, b.region || null, city, text(b.address, 200), text(b.phone, 30), req.user.id);
      db.prepare('INSERT INTO church_admins (church_id, user_id, title) VALUES (?, ?, ?)').run(lastInsertRowid, req.user.id, text(b.title, 40) || 'Church admin');
      return Number(lastInsertRowid);
    });
    ctx.notifyStaff('New church registration', name, '#/admin');
    res.status(201).json({ id, status: 'pending' });
  });

  // ---- Member's home church -------------------------------------------------
  app.post('/api/church-membership', ...member, (req, res) => {
    const church = db.prepare("SELECT * FROM churches WHERE id = ? AND status = 'approved'").get(Number(req.body?.churchId));
    if (!church) throw badRequest('Please choose a partner church.');
    const since = req.body?.memberSince ? Number(req.body.memberSince) : null;
    if (since !== null && (!Number.isInteger(since) || since < 1940 || since > new Date().getFullYear())) throw badRequest('Please give the year you joined.');
    db.prepare(`INSERT INTO church_memberships (user_id, church_id, member_since, ministry) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET church_id = excluded.church_id, member_since = excluded.member_since,
      ministry = excluded.ministry, status = 'pending', status_attested = NULL, note = NULL, reviewed_by = NULL, reviewed_at = NULL, created_at = datetime('now')`)
      .run(req.user.id, church.id, since, text(req.body?.ministry, 80));
    for (const a of db.prepare('SELECT user_id FROM church_admins WHERE church_id = ?').all(church.id)) {
      notifier.notify(a.user_id, { type: 'church', title: 'A member asked you to confirm their membership', link: `#/church/${church.id}` });
    }
    res.status(201).json({ status: 'pending' });
  });

  app.delete('/api/church-membership', auth, (req, res) => {
    db.prepare('DELETE FROM church_memberships WHERE user_id = ?').run(req.user.id);
    res.status(204).end();
  });

  // ---- Church portal --------------------------------------------------------
  app.get('/api/church-portal', auth, (req, res) => {
    res.json({
      churches: db.prepare(`SELECT c.id, c.name, c.city, c.status, a.title,
          (SELECT COUNT(*) FROM church_memberships WHERE church_id = c.id AND status = 'pending') AS pending
        FROM church_admins a JOIN churches c ON c.id = a.church_id WHERE a.user_id = ?`).all(req.user.id),
    });
  });

  app.get('/api/church-portal/:churchId', auth, (req, res) => {
    const c = myChurch(req);
    const rows = db.prepare(`SELECT m.*, p.first_name, p.birth_date, p.city, d.status AS declared
      FROM church_memberships m JOIN profiles p ON p.user_id = m.user_id JOIN users u ON u.id = m.user_id
      LEFT JOIN status_declarations d ON d.user_id = m.user_id
      WHERE m.church_id = ? AND u.status = 'active' ORDER BY m.status = 'pending' DESC, m.created_at DESC`).all(c.id);
    const shape = (r) => ({ userId: r.user_id, firstName: r.first_name, age: ageOn(r.birth_date), city: r.city, declaredStatus: r.declared, memberSince: r.member_since, ministry: r.ministry, status: r.status, statusAttested: r.status_attested, requestedAt: r.created_at });
    const confirmed = rows.filter((r) => r.status === 'confirmed');
    res.json({
      church: { id: c.id, name: c.name, city: c.city, denomination: c.denomination, title: c.title },
      pending: rows.filter((r) => r.status === 'pending').map(shape),
      members: confirmed.map(shape),
      report: {
        confirmedMembers: confirmed.length,
        shieldHolders: confirmed.filter((r) => ctx.trust.badge(r.user_id)?.shield).length,
        matchesAmongMembers: db.prepare(`SELECT COUNT(*) AS n FROM matches m WHERE m.user_a IN (SELECT user_id FROM church_memberships WHERE church_id = ? AND status = 'confirmed')
          OR m.user_b IN (SELECT user_id FROM church_memberships WHERE church_id = ? AND status = 'confirmed')`).get(c.id, c.id).n,
        upcomingEvents: db.prepare("SELECT COUNT(*) AS n FROM events WHERE church_id = ? AND status = 'published' AND starts_at > ?").get(c.id, new Date().toISOString()).n,
      },
      admins: db.prepare('SELECT a.user_id, a.title, p.first_name FROM church_admins a LEFT JOIN profiles p ON p.user_id = a.user_id WHERE a.church_id = ?').all(c.id),
      events: db.prepare('SELECT e.*, (SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id) AS rsvps FROM events e WHERE church_id = ? ORDER BY starts_at DESC LIMIT 20').all(c.id),
    });
  });

  /** A pastor or church admin confirms (or declines) membership and attests relationship status. */
  app.post('/api/church-portal/:churchId/memberships/:userId', auth, (req, res) => {
    const c = myChurch(req);
    const userId = Number(req.params.userId);
    if (userId === req.user.id) throw forbidden('Another leader of your church must confirm your own membership.');
    const m = db.prepare('SELECT * FROM church_memberships WHERE user_id = ? AND church_id = ?').get(userId, c.id);
    if (!m) throw notFound('Membership request not found.');
    const decision = req.body?.decision;
    if (!['confirm', 'decline'].includes(decision)) throw badRequest('Choose confirm or decline.');
    const attest = decision === 'confirm' ? req.body?.statusAttested : null;
    if (decision === 'confirm' && !ATTESTATIONS.includes(attest)) throw badRequest('Please say what you know about their relationship status.');
    transaction(db, () => {
      db.prepare("UPDATE church_memberships SET status = ?, status_attested = ?, note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE user_id = ?")
        .run(decision === 'confirm' ? 'confirmed' : 'declined', attest, text(req.body?.note, 500), req.user.id, userId);
      if (attest === 'not_single') {
        db.prepare("INSERT INTO risk_flags (user_id, source, ref, level, detail) VALUES (?, 'church', ?, 'high', ?)")
          .run(userId, String(c.id), `${c.name} reports this member is married or in a relationship.`);
      }
      audit(req.user.id, `church.membership.${decision}`, 'user', userId, { churchId: c.id, attest });
    });
    if (attest === 'not_single') ctx.notifyStaff('Church reported a member is not single', c.name, '#/staff');
    notifier.notify(userId, {
      type: 'church',
      title: decision === 'confirm' ? `${c.name} confirmed your membership` : `${c.name} could not confirm your membership`,
      link: '#/trust',
    });
    res.json({ status: decision === 'confirm' ? 'confirmed' : 'declined' });
  });

  app.post('/api/church-portal/:churchId/admins', auth, (req, res) => {
    const c = myChurch(req);
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(String(req.body?.email ?? '').trim().toLowerCase());
    if (!u) throw badRequest('They need a Purpose Partner account first.');
    db.prepare('INSERT OR IGNORE INTO church_admins (church_id, user_id, title) VALUES (?, ?, ?)').run(c.id, u.id, text(req.body?.title, 40) || 'Church admin');
    audit(req.user.id, 'church.admin.add', 'user', u.id, { churchId: c.id });
    res.status(201).json({ added: true });
  });

  app.post('/api/church-portal/:churchId/events', auth, (req, res) => {
    const c = myChurch(req);
    const v = eventValues(req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO events (church_id, created_by, title, description, starts_at, venue, city, capacity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, req.user.id, v.title, v.description, v.startsAt, v.venue, v.city || c.city, v.capacity);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.post('/api/church-portal/:churchId/events/:eventId/cancel', auth, (req, res) => {
    const c = myChurch(req);
    const r = db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ? AND church_id = ?").run(Number(req.params.eventId), c.id);
    if (!r.changes) throw notFound();
    for (const u of db.prepare('SELECT user_id FROM event_rsvps WHERE event_id = ?').all(Number(req.params.eventId))) {
      notifier.notify(u.user_id, { type: 'event', title: 'An event you planned to attend was cancelled', link: '#/events' });
    }
    res.status(204).end();
  });

}
