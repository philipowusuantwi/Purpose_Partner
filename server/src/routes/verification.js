import crypto from 'node:crypto';
import { transaction, parseJson } from '../db.js';
import { QUESTIONS, DIMENSION_LABELS, DISCLAIMER, scoreReadiness } from '../engines/readiness.js';
import { OPTIONS } from '../content/lists.js';
import { encrypt, decrypt, sha256, blindIndex, randomToken, otpCode } from '../services/secure.js';
import { tooMany } from '../services/rateLimit.js';
import { secret } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { normalisePhone, imageProblem, GHANA_CARD_RE, EMAIL_RE, text } from '../validation.js';
import { isBanned } from './account.js';

const MIN = 60_000;
const OTP_MINUTES = 10;
const OTP_ATTEMPTS = 5;
const MAX_REFERENCES = 3;
export const ID_CONSENT = { document: 'id_verification', version: '2026-10-draft-1' };

const GESTURES = ['a thumbs-up', 'two fingers in a V', 'your open palm', 'three fingers', 'your hand on your chin'];

/** Today's liveness challenge for a member: a gesture plus a code written on paper. */
export function livenessChallenge(userId, date) {
  const h = crypto.createHmac('sha256', `liveness:${secret()}`).update(`${userId}:${date}`).digest();
  return { gesture: GESTURES[h[0] % GESTURES.length], code: `PP-${String(h.readUInt16BE(1) % 10000).padStart(4, '0')}` };
}

const maskCard = (n) => `GHA-*****${n.slice(9, 13)}-${n.slice(-1)}`;

export default function verificationRoutes(app, ctx) {
  const { db, config, auth, member, members, trust, limiter, messenger, notifier, uploads, today } = ctx;
  const pendingOf = db.prepare("SELECT 1 FROM verifications WHERE user_id = ? AND kind = ? AND status = 'pending'");
  const approvedOf = db.prepare("SELECT 1 FROM verifications WHERE user_id = ? AND kind = ? AND status = 'approved'");
  const flag = db.prepare('INSERT INTO risk_flags (user_id, source, ref, level, detail) VALUES (?, ?, ?, ?, ?)');

  function startCheck(userId, kind) {
    if (approvedOf.get(userId, kind)) throw badRequest('This check is already complete.');
    if (pendingOf.get(userId, kind)) throw badRequest('Your submission is being reviewed. We will let you know soon.');
  }

  app.get('/api/trust', auth, (req, res) => {
    const verifications = db.prepare('SELECT kind, status, meta, reason, created_at, reviewed_at FROM verifications WHERE user_id = ? ORDER BY id DESC')
      .all(req.user.id).map((v) => ({ ...v, meta: parseJson(v.meta, {}) }));
    const church = db.prepare(`SELECT m.status, m.status_attested, m.note, c.id AS church_id, c.name, c.city FROM church_memberships m
      JOIN churches c ON c.id = m.church_id WHERE m.user_id = ?`).get(req.user.id) ?? null;
    res.json({
      report: members.profile(req.user.id) ? trust.report(req.user.id) : null,
      verifications,
      declaration: db.prepare('SELECT status, declared_at FROM status_declarations WHERE user_id = ?').get(req.user.id) ?? null,
      church,
      liveness: livenessChallenge(req.user.id, today(req)),
    });
  });

  // ---- Phone OTP ------------------------------------------------------------
  app.post('/api/verify/phone/send', auth, async (req, res) => {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) throw badRequest('Please enter a valid phone number, e.g. 024 123 4567.');
    const index = blindIndex(phone);
    const owner = db.prepare('SELECT id FROM users WHERE phone_index = ?').get(index);
    if (owner && owner.id !== req.user.id) return res.status(409).json({ error: 'This number is already linked to another account.' });
    if (isBanned(db, 'phone', index)) throw badRequest('This number cannot be used. Please contact support.');
    const r = limiter.hit(`otp-send:${req.user.id}`, 5, 60 * MIN);
    if (!r.ok) return tooMany(res, r.retryAfter);
    const code = otpCode();
    db.prepare(`INSERT INTO otp_codes (user_id, phone_enc, phone_index, code_hash, attempts, expires_at)
      VALUES (?, ?, ?, ?, 0, datetime('now', ?)) ON CONFLICT (user_id) DO UPDATE SET phone_enc = excluded.phone_enc,
      phone_index = excluded.phone_index, code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at`)
      .run(req.user.id, encrypt(phone), index, sha256(`${req.user.id}:${code}`), `+${OTP_MINUTES} minutes`);
    await messenger.sms({ to: phone, text: `Your Purpose Partner code is ${code}. It expires in ${OTP_MINUTES} minutes. Never share it with anyone.` });
    // In pilot mode (no SMS provider yet) the code is shown in the app.
    res.json({ sent: true, ...(config().pilot && { pilotCode: code }) });
  });

  app.post('/api/verify/phone/confirm', auth, (req, res) => {
    const row = db.prepare("SELECT * FROM otp_codes WHERE user_id = ? AND expires_at > datetime('now')").get(req.user.id);
    if (!row || row.attempts >= OTP_ATTEMPTS) throw badRequest('This code has expired. Please request a new one.');
    const code = String(req.body?.code ?? '').trim();
    if (sha256(`${req.user.id}:${code}`) !== row.code_hash) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE user_id = ?').run(req.user.id);
      throw badRequest('That code is not correct.');
    }
    transaction(db, () => {
      const taken = db.prepare('SELECT id FROM users WHERE phone_index = ? AND id != ?').get(row.phone_index, req.user.id);
      if (taken) throw badRequest('This number is already linked to another account.');
      db.prepare('UPDATE users SET phone_enc = ?, phone_index = ?, phone_verified = 1 WHERE id = ?').run(row.phone_enc, row.phone_index, req.user.id);
      db.prepare('DELETE FROM otp_codes WHERE user_id = ?').run(req.user.id);
    });
    res.json(members.me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  });

  // ---- Ghana Card -----------------------------------------------------------
  app.post('/api/uploads/ghana-card', uploads, ...member, (req, res) => {
    const b = req.body ?? {};
    const cardNumber = String(b.cardNumber ?? '').trim().toUpperCase();
    if (!GHANA_CARD_RE.test(cardNumber)) throw badRequest('Please enter your Ghana Card number as shown, e.g. GHA-123456789-0.');
    for (const img of [b.front, b.back]) {
      const problem = imageProblem(img, 3_000_000);
      if (problem) throw badRequest(problem);
    }
    if (!b.consent) throw badRequest('Please consent to identity verification.', 'consent_required');
    startCheck(req.user.id, 'ghana_card');
    const docIndex = blindIndex(cardNumber);
    if (isBanned(db, 'ghana_card', docIndex)) throw badRequest('We cannot verify this card. Please contact support.');

    const id = transaction(db, () => {
      db.prepare('INSERT INTO consents (user_id, document, version) VALUES (?, ?, ?)').run(req.user.id, ID_CONSENT.document, ID_CONSENT.version);
      const { lastInsertRowid } = db.prepare(`INSERT INTO verifications (user_id, kind, payload_enc, meta, doc_index)
        VALUES (?, 'ghana_card', ?, ?, ?)`).run(req.user.id, encrypt({ cardNumber, front: b.front, back: b.back }),
        JSON.stringify({ masked: maskCard(cardNumber) }), docIndex);
      // The same card on another account is a strong impersonation signal.
      const other = db.prepare("SELECT user_id FROM verifications WHERE kind = 'ghana_card' AND doc_index = ? AND user_id != ? AND status != 'rejected' LIMIT 1")
        .get(docIndex, req.user.id);
      if (other) flag.run(req.user.id, 'duplicate_document', String(other.user_id), 'high', 'Ghana Card number already used by another account.');
      return Number(lastInsertRowid);
    });
    ctx.notifyStaff('New Ghana Card to review', null, '#/staff');
    res.status(201).json({ id, status: 'pending' });
  });

  // ---- Liveness selfie ------------------------------------------------------
  app.post('/api/uploads/liveness', uploads, ...member, (req, res) => {
    const problem = imageProblem(req.body?.selfie, 3_000_000);
    if (problem) throw badRequest(problem);
    startCheck(req.user.id, 'liveness');
    const challenge = livenessChallenge(req.user.id, today(req));
    db.prepare("INSERT INTO verifications (user_id, kind, payload_enc, meta) VALUES (?, 'liveness', ?, ?)")
      .run(req.user.id, encrypt({ selfie: req.body.selfie }), JSON.stringify({ challenge }));
    ctx.notifyStaff('New liveness selfie to review', null, '#/staff');
    res.status(201).json({ status: 'pending' });
  });

  // ---- Relationship status (Marriage Transparency Shield) -------------------
  app.post('/api/verify/status', ...member, (req, res) => {
    const status = req.body?.status;
    if (!OPTIONS.relationship_status.includes(status)) throw badRequest('Please choose your relationship status.');
    if (!req.body?.confirmNotMarried) throw badRequest('Please confirm you are not married, engaged or in a relationship.');
    const prev = db.prepare('SELECT status FROM status_declarations WHERE user_id = ?').get(req.user.id);
    transaction(db, () => {
      db.prepare(`INSERT INTO status_declarations (user_id, status) VALUES (?, ?)
        ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, declared_at = datetime('now')`).run(req.user.id, status);
      // A changed declaration needs fresh evidence and a fresh church attestation.
      if (prev && prev.status !== status) {
        db.prepare("DELETE FROM verifications WHERE user_id = ? AND kind = 'status_evidence'").run(req.user.id);
        db.prepare('UPDATE church_memberships SET status_attested = NULL WHERE user_id = ?').run(req.user.id);
      }
    });
    res.json({ declared: status });
  });

  app.post('/api/uploads/status-evidence', uploads, ...member, (req, res) => {
    const decl = db.prepare('SELECT status FROM status_declarations WHERE user_id = ?').get(req.user.id);
    if (!decl || decl.status === 'never_married') throw badRequest('Evidence is only needed if you are divorced, widowed or had an annulment.');
    const problem = imageProblem(req.body?.document, 3_000_000);
    if (problem) throw badRequest(problem);
    startCheck(req.user.id, 'status_evidence');
    db.prepare("INSERT INTO verifications (user_id, kind, payload_enc, meta) VALUES (?, 'status_evidence', ?, ?)")
      .run(req.user.id, encrypt({ document: req.body.document }), JSON.stringify({ declared: decl.status }));
    ctx.notifyStaff('New relationship-status evidence to review', null, '#/staff');
    res.status(201).json({ status: 'pending' });
  });

  // ---- Character references -------------------------------------------------
  app.get('/api/verify/references', auth, (req, res) => {
    res.json({ references: db.prepare('SELECT id, name, relationship, status, positive, created_at, responded_at FROM references_ WHERE user_id = ? ORDER BY id').all(req.user.id) });
  });

  app.post('/api/verify/references', ...member, async (req, res) => {
    const name = text(req.body?.name, 80);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const relationship = text(req.body?.relationship, 80);
    if (!name || !relationship) throw badRequest('Please give their name and how they know you.');
    if (!EMAIL_RE.test(email)) throw badRequest('Please enter a valid email address for your reference.');
    if (email === req.user.email) throw badRequest('You cannot be your own reference.');
    const active = db.prepare("SELECT COUNT(*) AS n FROM references_ WHERE user_id = ? AND status != 'declined'").get(req.user.id).n;
    if (active >= MAX_REFERENCES) throw badRequest(`You can invite up to ${MAX_REFERENCES} references.`);
    if (!limiter.hit(`ref-invite:${req.user.id}`, 6, 24 * 60 * MIN).ok) return tooMany(res, 3600);
    const token = randomToken();
    db.prepare('INSERT INTO references_ (user_id, name, contact_enc, relationship, token_hash) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, name, encrypt(email), relationship, sha256(token));
    const first = members.profile(req.user.id).first_name;
    await messenger.email({
      to: email,
      subject: `${first} has asked you to be a character reference`,
      text: `Hello ${name},\n\n${first} has joined Purpose Partner, a Christian relationship and marriage platform, and named you as a character reference (${relationship}).\n\nIt takes about two minutes:\n${config().appUrl}/#/reference?token=${token}\n\nYour answers are confidential. ${first} will only see whether the reference was completed, not what you wrote.\n\nThank you,\nPurpose Partner`,
    });
    res.status(201).json({ sent: true });
  });

  const byToken = (token) => (typeof token === 'string' && token.length >= 20 && token.length <= 200
    ? db.prepare("SELECT * FROM references_ WHERE token_hash = ? AND status = 'sent'").get(sha256(token)) : null);

  app.get('/api/references/:token', limiter.middleware({ name: 'ref-ip', max: 60, windowMs: 60 * MIN }), (req, res) => {
    const ref = byToken(req.params.token);
    if (!ref) throw notFound('This reference link is no longer valid.');
    res.json({ referenceName: ref.name, relationship: ref.relationship, memberFirstName: members.profile(ref.user_id)?.first_name ?? 'The member' });
  });

  app.post('/api/references/:token', limiter.middleware({ name: 'ref-ip', max: 60, windowMs: 60 * MIN }), (req, res) => {
    const ref = byToken(req.params.token);
    if (!ref) throw notFound('This reference link is no longer valid.');
    const b = req.body ?? {};
    if (b.decline) {
      db.prepare("UPDATE references_ SET status = 'declined', responded_at = datetime('now') WHERE id = ?").run(ref.id);
      notifier.notify(ref.user_id, { type: 'reference', title: `${ref.name} declined to give a reference`, link: '#/trust' });
      return res.json({ done: true });
    }
    const ratings = ['honesty', 'kindness', 'faithfulness'].map((k) => Number(b[k]));
    const years = Number(b.knownYears);
    if (ratings.some((r) => !Number.isInteger(r) || r < 1 || r > 5)) throw badRequest('Please rate each quality from 1 to 5.');
    if (!Number.isFinite(years) || years < 0 || years > 80) throw badRequest('Please say how many years you have known them.');
    if (!['yes', 'no', 'unsure'].includes(b.confirmsSingle)) throw badRequest('Please answer whether they are single.');
    if (typeof b.recommend !== 'boolean') throw badRequest('Please say whether you would recommend them.');
    const avg = ratings.reduce((a, c) => a + c, 0) / ratings.length;
    const positive = b.confirmsSingle === 'yes' && b.recommend && avg >= 3.5 && years >= 1;
    const answers = { knownYears: years, honesty: ratings[0], kindness: ratings[1], faithfulness: ratings[2], confirmsSingle: b.confirmsSingle, recommend: b.recommend, comment: text(b.comment, 1000) };
    transaction(db, () => {
      db.prepare("UPDATE references_ SET status = 'completed', answers = ?, positive = ?, responded_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(answers), positive ? 1 : 0, ref.id);
      if (b.confirmsSingle === 'no') flag.run(ref.user_id, 'reference', String(ref.id), 'high', 'A character reference said this member is not single.');
      else if (!b.recommend) flag.run(ref.user_id, 'reference', String(ref.id), 'caution', 'A character reference would not recommend this member.');
    });
    notifier.notify(ref.user_id, { type: 'reference', title: `${ref.name} completed your reference`, body: 'Thank you for building trust in the community.', link: '#/trust' });
    res.json({ done: true });
  });

  // ---- Readiness assessment -------------------------------------------------
  app.get('/api/readiness', auth, (req, res) => {
    const latest = db.prepare('SELECT scores, created_at FROM readiness_results WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
    res.json({
      questions: QUESTIONS.map(({ id, text: t }) => ({ id, text: t })),
      labels: DIMENSION_LABELS,
      disclaimer: DISCLAIMER,
      latest: latest ? { ...parseJson(latest.scores, {}), createdAt: latest.created_at } : null,
    });
  });

  app.post('/api/readiness', ...member, (req, res) => {
    const { scores, errors } = scoreReadiness(req.body?.answers);
    if (errors) throw badRequest(errors[0]);
    db.prepare('INSERT INTO readiness_results (user_id, answers, scores) VALUES (?, ?, ?)').run(req.user.id, JSON.stringify(req.body.answers), JSON.stringify(scores));
    res.status(201).json({ result: scores, disclaimer: DISCLAIMER });
  });

  // Staff helper: decrypt a submission for review.
  ctx.readSubmission = (v) => { try { return v.payload_enc ? decrypt(v.payload_enc) : null; } catch { return null; } };
}
