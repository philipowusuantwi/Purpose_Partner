import { transaction, parseJson } from '../db.js';
import { compatibility, eligible } from '../engines/matching.js';
import { scanMessage, RISK_LABELS } from '../engines/scam.js';
import { TIER_RANK } from '../engines/integrity.js';
import { STAGES } from '../content/lists.js';
import { tooMany } from '../services/rateLimit.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { text } from '../validation.js';

const DISCOVER_LIMIT = 30;

export default function matchRoutes(app, ctx) {
  const { db, config, member, members, trust, notifier, limiter } = ctx;

  // Members who could appear in someone's Discover: active, visible, not hidden by safety
  // systems, email verified and with at least one approved photo.
  const VISIBLE = `u.status = 'active' AND u.email_verified = 1 AND p.visible = 1 AND p.hidden_reason IS NULL
    AND EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = p.user_id AND ph.status = 'approved')`;

  const q = {
    candidates: db.prepare(`SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE ${VISIBLE} AND p.user_id != :me AND p.gender != :gender
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = :me AND blocked_id = p.user_id) OR (blocker_id = p.user_id AND blocked_id = :me))
        AND NOT EXISTS (SELECT 1 FROM interests WHERE from_id = :me AND to_id = p.user_id)
        AND NOT EXISTS (SELECT 1 FROM interests WHERE from_id = p.user_id AND to_id = :me AND kind = 'pass')
        AND NOT EXISTS (SELECT 1 FROM matches WHERE user_a = MIN(:me, p.user_id) AND user_b = MAX(:me, p.user_id))`),
    visible: db.prepare(`SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND ${VISIBLE}`),
    interest: db.prepare('SELECT * FROM interests WHERE from_id = ? AND to_id = ?'),
    todayCount: db.prepare("SELECT COUNT(*) AS n FROM interests WHERE from_id = ? AND kind = 'interest' AND created_at >= datetime('now', '-1 day')"),
    match: db.prepare('SELECT * FROM matches WHERE id = ?'),
    pair: db.prepare('SELECT * FROM matches WHERE user_a = ? AND user_b = ?'),
  };

  const other = (m, me) => (m.user_a === me ? m.user_b : m.user_a);

  /** Load a match the member belongs to (active unless allowClosed). */
  function myMatch(req, { allowClosed = false } = {}) {
    const m = q.match.get(Number(req.params.id));
    if (!m || (m.user_a !== req.user.id && m.user_b !== req.user.id)) throw notFound('Match not found.');
    if (!allowClosed && m.status !== 'active') throw badRequest('This conversation has ended.');
    return m;
  }

  const summary = (userId) => {
    const c = members.card(userId);
    return c && { id: c.id, firstName: c.firstName, age: c.age, city: c.city, denomination: c.denomination, photo: c.photos[0]?.data ?? null, trust: c.trust };
  };

  app.get('/api/discover', ...member, (req, res) => {
    const me = members.matchProfile(req.user.id);
    const minTier = TIER_RANK[req.query.minTier] ?? 0;
    const verifiedOnly = req.query.verifiedOnly === '1';
    const shieldOnly = req.query.shieldOnly === '1';
    const results = [];
    for (const { user_id: id } of q.candidates.all({ me: req.user.id, gender: me.gender })) {
      const them = members.matchProfile(id);
      if (!eligible(me, them)) continue;
      const badge = trust.badge(id);
      if (TIER_RANK[badge.tier] < minTier || (verifiedOnly && !badge.identityVerified) || (shieldOnly && !badge.shield)) continue;
      results.push({ id, compat: compatibility(me, them), badge });
    }
    // Rank by compatibility with a small boost for trust.
    results.sort((a, b) => (b.compat.score + b.badge.score * 0.15) - (a.compat.score + a.badge.score * 0.15));
    res.json({
      members: results.slice(0, DISCOVER_LIMIT).map((r) => ({ ...members.card(r.id), compatibility: r.compat })),
      interestsLeft: members.premiumUntil(req.user.id) ? null : Math.max(0, config().freeDailyInterests - q.todayCount.get(req.user.id).n),
    });
  });

  app.post('/api/interests', ...member, (req, res) => {
    const toId = Number(req.body?.toId);
    const kind = req.body?.kind === 'pass' ? 'pass' : 'interest';
    if (!Number.isInteger(toId) || toId === req.user.id) throw badRequest('Choose a member.');
    if (!q.visible.get(toId) || members.blocked(req.user.id, toId)) throw notFound('This profile is not available.');
    const me = members.matchProfile(req.user.id);
    const them = members.matchProfile(toId);
    if (!eligible(me, them)) throw badRequest('This member is outside your or their preferences.');
    if (q.pair.get(Math.min(req.user.id, toId), Math.max(req.user.id, toId))) throw badRequest('You are already matched.');
    if (kind === 'interest' && !members.premiumUntil(req.user.id) && q.todayCount.get(req.user.id).n >= config().freeDailyInterests) {
      throw forbidden(`You have used today's ${config().freeDailyInterests} interests. Premium members have no daily limit.`, 'premium_required');
    }
    const note = kind === 'interest' ? text(req.body?.note, 280) : null;

    const result = transaction(db, () => {
      db.prepare(`INSERT INTO interests (from_id, to_id, kind, note) VALUES (?, ?, ?, ?)
        ON CONFLICT (from_id, to_id) DO UPDATE SET kind = excluded.kind, note = excluded.note, created_at = datetime('now')`)
        .run(req.user.id, toId, kind, note);
      if (kind !== 'interest' || q.interest.get(toId, req.user.id)?.kind !== 'interest') return { matched: false };
      const [a, b] = [Math.min(req.user.id, toId), Math.max(req.user.id, toId)];
      const { lastInsertRowid } = db.prepare('INSERT INTO matches (user_a, user_b) VALUES (?, ?)').run(a, b);
      return { matched: true, matchId: Number(lastInsertRowid) };
    });

    if (result.matched) {
      for (const [u, o] of [[req.user.id, toId], [toId, req.user.id]]) {
        notifier.notify(u, { type: 'match', title: `It's a match with ${members.profile(o).first_name}`, body: 'You both expressed interest. Start a gracious conversation.', link: `#/matches/${result.matchId}` });
      }
    } else if (kind === 'interest') {
      notifier.notify(toId, { type: 'interest', title: 'Someone is interested in you', body: 'See who in Discover or with Premium.', link: '#/interests' });
    }
    res.status(201).json(result);
  });

  /** People interested in me that I have not answered. Premium sees who they are. */
  app.get('/api/interests/received', ...member, (req, res) => {
    const rows = db.prepare(`SELECT i.from_id, i.note, i.created_at FROM interests i JOIN users u ON u.id = i.from_id
      WHERE i.to_id = ? AND i.kind = 'interest' AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM interests r WHERE r.from_id = i.to_id AND r.to_id = i.from_id)
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = i.to_id AND blocked_id = i.from_id) OR (blocker_id = i.from_id AND blocked_id = i.to_id))
      ORDER BY i.created_at DESC`).all(req.user.id);
    if (!members.premiumUntil(req.user.id)) return res.json({ count: rows.length, members: null, premiumRequired: true });
    const me = members.matchProfile(req.user.id);
    res.json({
      count: rows.length,
      members: rows.map((r) => ({ ...members.card(r.from_id), note: r.note, compatibility: compatibility(me, members.matchProfile(r.from_id)) })),
    });
  });

  app.get('/api/matches', ...member, (req, res) => {
    const me = req.user.id;
    const rows = db.prepare(`SELECT m.*,
        (SELECT body FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) AS last_body,
        (SELECT created_at FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM messages WHERE match_id = m.id AND sender_id != ? AND read_at IS NULL) AS unread
      FROM matches m WHERE (m.user_a = ? OR m.user_b = ?) AND m.status = 'active'
      ORDER BY COALESCE(last_at, m.created_at) DESC`).all(me, me, me);
    res.json({
      matches: rows.map((m) => ({ id: m.id, stage: m.stage, createdAt: m.created_at, lastMessage: m.last_body, lastAt: m.last_at, unread: m.unread, member: summary(other(m, me)) }))
        .filter((m) => m.member),
    });
  });

  app.get('/api/matches/:id', ...member, (req, res) => {
    const m = myMatch(req, { allowClosed: true });
    const otherId = other(m, req.user.id);
    res.json({
      match: { id: m.id, status: m.status, stage: m.stage, proposedStage: m.proposed_stage, proposedByMe: m.proposed_by === req.user.id, createdAt: m.created_at },
      member: members.card(otherId),
      compatibility: compatibility(members.matchProfile(req.user.id), members.matchProfile(otherId)),
      stages: STAGES,
    });
  });

  app.get('/api/matches/:id/messages', ...member, (req, res) => {
    const m = myMatch(req, { allowClosed: true });
    const after = Number(req.query.after) || 0;
    db.prepare("UPDATE messages SET read_at = datetime('now') WHERE match_id = ? AND sender_id != ? AND read_at IS NULL").run(m.id, req.user.id);
    const rows = db.prepare('SELECT id, sender_id, body, risk, risk_reasons, created_at, read_at FROM messages WHERE match_id = ? AND id > ? ORDER BY id LIMIT 200').all(m.id, after);
    res.json({
      messages: rows.map((r) => ({
        id: r.id, mine: r.sender_id === req.user.id, body: r.body, createdAt: r.created_at, read: Boolean(r.read_at),
        risk: r.risk, warnings: parseJson(r.risk_reasons, []).map((id) => RISK_LABELS[id]),
      })),
    });
  });

  app.post('/api/matches/:id/messages', ...member, (req, res) => {
    const m = myMatch(req);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 2000) throw badRequest('Messages must be between 1 and 2000 characters.');
    const r = limiter.hit(`msg:${req.user.id}`, 30, 60_000);
    if (!r.ok) return tooMany(res, r.retryAfter);
    const otherId = other(m, req.user.id);
    if (members.blocked(req.user.id, otherId)) throw badRequest('This conversation has ended.');

    const prior = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE match_id = ?').get(m.id).n;
    const scan = scanMessage(body, { priorMessages: prior });
    const id = transaction(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO messages (match_id, sender_id, body, risk, risk_reasons) VALUES (?, ?, ?, ?, ?)')
        .run(m.id, req.user.id, body, scan.risk, JSON.stringify(scan.reasons));
      if (scan.risk === 'high') {
        db.prepare("INSERT INTO risk_flags (user_id, source, ref, level, detail) VALUES (?, 'message', ?, 'high', ?)")
          .run(req.user.id, String(lastInsertRowid), scan.reasons.map((x) => RISK_LABELS[x]).join('; '));
      }
      return Number(lastInsertRowid);
    });
    if (scan.risk === 'high') ctx.notifyStaff('Message flagged for possible scam', null, '#/staff');
    const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE match_id = ? AND sender_id = ? AND read_at IS NULL').get(m.id, req.user.id).n;
    if (unread === 1) {
      notifier.notify(otherId, { type: 'message', title: `New message from ${members.profile(req.user.id).first_name}`, link: `#/matches/${m.id}` });
    }
    res.status(201).json({ id, risk: scan.risk, warnings: scan.reasons.map((x) => RISK_LABELS[x]) });
  });

  /** Courtship journey: either member proposes the next stage; the other confirms. */
  app.post('/api/matches/:id/stage', ...member, (req, res) => {
    const m = myMatch(req);
    const otherId = other(m, req.user.id);
    if (req.body?.decline) {
      db.prepare('UPDATE matches SET proposed_stage = NULL, proposed_by = NULL WHERE id = ?').run(m.id);
      return res.json({ stage: m.stage, proposedStage: null });
    }
    const idx = STAGES.findIndex((s) => s.id === m.stage);
    const next = STAGES[idx + 1];
    if (!next || req.body?.stage !== next.id) throw badRequest('You can only move to the next stage of the journey.');
    if (m.proposed_stage === next.id && m.proposed_by === otherId) {
      db.prepare('UPDATE matches SET stage = ?, proposed_stage = NULL, proposed_by = NULL WHERE id = ?').run(next.id, m.id);
      notifier.notify(otherId, { type: 'stage', title: `You are now: ${next.label}`, body: `${members.profile(req.user.id).first_name} agreed.`, link: `#/matches/${m.id}` });
      return res.json({ stage: next.id, proposedStage: null });
    }
    db.prepare('UPDATE matches SET proposed_stage = ?, proposed_by = ? WHERE id = ?').run(next.id, req.user.id, m.id);
    notifier.notify(otherId, { type: 'stage', title: `${members.profile(req.user.id).first_name} would like to move to: ${next.label}`, link: `#/matches/${m.id}` });
    res.json({ stage: m.stage, proposedStage: next.id });
  });

  app.post('/api/matches/:id/close', ...member, (req, res) => {
    const m = myMatch(req);
    db.prepare("UPDATE matches SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(m.id);
    res.status(204).end();
  });
}
