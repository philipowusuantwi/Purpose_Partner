import { transaction } from '../db.js';
import { REPORT_REASONS } from '../content/lists.js';
import { encrypt, decrypt } from '../services/secure.js';
import { tooMany } from '../services/rateLimit.js';
import { badRequest, notFound } from '../errors.js';
import { text, EMAIL_RE, normalisePhone } from '../validation.js';

export default function safetyRoutes(app, ctx) {
  const { db, config, auth, member, members, messenger, limiter } = ctx;

  const closeMatch = (a, b) => db.prepare("UPDATE matches SET status = 'closed', closed_at = datetime('now') WHERE user_a = ? AND user_b = ? AND status = 'active'")
    .run(Math.min(a, b), Math.max(a, b));

  app.get('/api/blocks', auth, (req, res) => {
    const rows = db.prepare('SELECT b.blocked_id, b.created_at, p.first_name FROM blocks b LEFT JOIN profiles p ON p.user_id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC').all(req.user.id);
    res.json({ blocked: rows.map((r) => ({ id: r.blocked_id, firstName: r.first_name, createdAt: r.created_at })) });
  });

  app.post('/api/blocks', auth, (req, res) => {
    const id = Number(req.body?.userId);
    if (!Number.isInteger(id) || id === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw badRequest('Choose a member to block.');
    transaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, id);
      closeMatch(req.user.id, id);
    });
    res.status(201).json({ blocked: true });
  });

  app.delete('/api/blocks/:id', auth, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, Number(req.params.id));
    res.status(204).end();
  });

  /**
   * Report a member. Reports are confidential. After `autoHideReports` open reports from
   * different members, the profile is hidden from Discover pending review.
   */
  app.post('/api/reports', auth, (req, res) => {
    const b = req.body ?? {};
    const reportedId = Number(b.userId);
    if (!Number.isInteger(reportedId) || reportedId === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(reportedId)) throw badRequest('Choose a member to report.');
    if (!REPORT_REASONS[b.reason]) throw badRequest('Please choose a reason.');
    const r = limiter.hit(`report:${req.user.id}`, 10, 24 * 3_600_000);
    if (!r.ok) return tooMany(res, r.retryAfter);
    let messageId = null;
    if (b.messageId !== undefined) {
      // Only a message from the reported member, in a conversation the reporter is part of.
      const msg = db.prepare(`SELECT ms.id FROM messages ms JOIN matches m ON m.id = ms.match_id
        WHERE ms.id = ? AND ms.sender_id = ? AND (m.user_a = ? OR m.user_b = ?)`).get(Number(b.messageId), reportedId, req.user.id, req.user.id);
      if (!msg) throw badRequest('That message cannot be reported.');
      messageId = msg.id;
    }
    transaction(db, () => {
      db.prepare('INSERT INTO reports (reporter_id, reported_id, message_id, reason, details) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, reportedId, messageId, b.reason, text(b.details, 2000));
      if (b.block) {
        db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, reportedId);
        closeMatch(req.user.id, reportedId);
      }
      const reporters = db.prepare("SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE reported_id = ? AND status = 'open'").get(reportedId).n;
      if (reporters >= config().autoHideReports || b.reason === 'underage') {
        db.prepare("UPDATE profiles SET hidden_reason = 'reports' WHERE user_id = ? AND hidden_reason IS NULL").run(reportedId);
      }
    });
    ctx.notifyStaff('New safety report', REPORT_REASONS[b.reason], '#/staff');
    res.status(201).json({ reported: true, message: 'Thank you. Our trust & safety team will review this confidentially.' });
  });

  // ---- Safe meet-up ---------------------------------------------------------
  const plan = (req) => {
    const p = db.prepare('SELECT * FROM safety_plans WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!p) throw notFound();
    return p;
  };
  const contactOf = (p) => decrypt(p.contact_enc);

  async function tellContact(p, subject, body) {
    const c = contactOf(p);
    if (c.email) await messenger.email({ to: c.email, subject, text: body });
    if (c.phone) await messenger.sms({ to: c.phone, text: body.slice(0, 450) });
  }

  app.get('/api/safety-plans', ...member, (req, res) => {
    const rows = db.prepare('SELECT * FROM safety_plans WHERE user_id = ? ORDER BY starts_at DESC LIMIT 20').all(req.user.id);
    res.json({ plans: rows.map(({ contact_enc: enc, ...p }) => ({ ...p, contact: (() => { try { return decrypt(enc); } catch { return null; } })() })) });
  });

  /** Share a date plan with a trusted contact (email and/or SMS). */
  app.post('/api/safety-plans', ...member, async (req, res) => {
    const b = req.body ?? {};
    const place = text(b.place, 200);
    const contactName = text(b.contactName, 80);
    const email = b.contactEmail ? String(b.contactEmail).trim().toLowerCase() : null;
    const phone = b.contactPhone ? normalisePhone(b.contactPhone) : null;
    const startsAt = typeof b.startsAt === 'string' && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt).toISOString() : null;
    if (!place || !startsAt || !contactName) throw badRequest('Please give the place, date and time, and your trusted contact.');
    if (email && !EMAIL_RE.test(email)) throw badRequest('Please check your contact\'s email address.');
    if (b.contactPhone && !phone) throw badRequest('Please check your contact\'s phone number.');
    if (!email && !phone) throw badRequest('Please give an email or phone number for your trusted contact.');
    let matchId = null;
    let withName = 'someone they met on Purpose Partner';
    if (b.matchId) {
      const m = db.prepare('SELECT * FROM matches WHERE id = ? AND (user_a = ? OR user_b = ?)').get(Number(b.matchId), req.user.id, req.user.id);
      if (!m) throw badRequest('Match not found.');
      matchId = m.id;
      const otherId = m.user_a === req.user.id ? m.user_b : m.user_a;
      const c = members.card(otherId);
      withName = `${c.firstName} (${c.age}, ${c.city ?? ''}${c.trust?.identityVerified ? ', ID-verified' : ''})`;
    }
    if (!limiter.hit(`safety-plan:${req.user.id}`, 10, 24 * 3_600_000).ok) return tooMany(res, 3600);
    const { lastInsertRowid } = db.prepare('INSERT INTO safety_plans (user_id, match_id, place, starts_at, contact_name, contact_enc) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, matchId, place, startsAt, contactName, encrypt({ email, phone }));
    const p = db.prepare('SELECT * FROM safety_plans WHERE id = ?').get(lastInsertRowid);
    const me = members.profile(req.user.id).first_name;
    await tellContact(p, `${me} shared a meet-up plan with you`,
      `Hello ${contactName},\n\n${me} is meeting ${withName}.\n\nWhere: ${place}\nWhen: ${new Date(startsAt).toUTCString()}\n\n${me} will let you know when they are home safe. If you do not hear from them, please check in.\n\nPurpose Partner Safe Meet-up`);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.post('/api/safety-plans/:id/safe', ...member, async (req, res) => {
    const p = plan(req);
    db.prepare("UPDATE safety_plans SET status = 'safe' WHERE id = ?").run(p.id);
    const me = members.profile(req.user.id).first_name;
    await tellContact(p, `${me} is safe`, `${me} has checked in safely after their meet-up at ${p.place}.`);
    res.json({ status: 'safe' });
  });

  /** Emergency: alert the trusted contact immediately. */
  app.post('/api/safety-plans/:id/alert', ...member, async (req, res) => {
    const p = plan(req);
    db.prepare("UPDATE safety_plans SET status = 'alert' WHERE id = ?").run(p.id);
    const me = members.profile(req.user.id).first_name;
    await tellContact(p, `URGENT: ${me} needs help`,
      `${me} pressed the emergency button during their meet-up.\n\nWhere: ${p.place}\nPlanned for: ${new Date(p.starts_at).toUTCString()}\n\nPlease call them now. If you cannot reach them, contact the police (Ghana: 191 or 18555).`);
    ctx.notifyStaff('Safe meet-up emergency alert', `Member #${req.user.id}`, '#/staff');
    res.json({ status: 'alert' });
  });
}
