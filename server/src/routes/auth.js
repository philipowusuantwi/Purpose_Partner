import { hashPassword, verifyPassword, issueToken, passwordProblem } from '../auth.js';
import { transaction } from '../db.js';
import { DOCUMENTS, REQUIRED_DOCUMENTS } from '../content/legal.js';
import { sha256, randomToken, blindIndex } from '../services/secure.js';
import { isBanned } from './account.js';
import { tooMany } from '../services/rateLimit.js';
import { badRequest } from '../errors.js';
import { EMAIL_RE } from '../validation.js';

const MIN = 60_000;
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW = 15 * MIN;
export const SENSITIVE_CONSENT = { document: 'sensitive_data', version: '2026-10-draft-1' };

export default function authRoutes(app, ctx) {
  const { db, config, limiter, messenger, members, authBasic, authSuspended } = ctx;
  const q = {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  };
  const normEmail = (e) => String(e ?? '').trim().toLowerCase();
  const session = (user) => ({ token: issueToken(user), ...members.me(user) });

  function createAuthToken(userId, purpose, ttlMinutes) {
    const raw = randomToken();
    db.prepare("INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
      .run(userId, purpose, sha256(raw), `+${ttlMinutes} minutes`);
    return raw;
  }
  // Shared with the admin module (pilot-mode password reset links).
  ctx.createAuthToken = createAuthToken;

  function consumeAuthToken(raw, purpose) {
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
    const row = db.prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?
      AND used_at IS NULL AND expires_at > datetime('now')`).get(sha256(raw), purpose);
    if (!row) return null;
    db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
    return row;
  }

  async function sendVerification(user) {
    const token = createAuthToken(user.id, 'verify', 60 * 24 * 3);
    await messenger.email({
      to: user.email,
      subject: 'Verify your Purpose Partner email',
      text: `Welcome to Purpose Partner!\n\nPlease confirm your email address:\n${config().appUrl}/#/verify-email?token=${token}\n\nThis link expires in 3 days.`,
    });
  }

  const promoteIfAdmin = (user) => {
    if (user.role !== 'admin' && config().adminEmails.includes(user.email)) {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
      return q.byId.get(user.id);
    }
    return user;
  };

  app.post('/api/auth/register', (req, res, next) => {
    const r = limiter.hit(`register:${req.ip}`, config().registerPerHourPerIp, 60 * MIN);
    return r.ok ? next() : tooMany(res, r.retryAfter);
  }, async (req, res) => {
    const b = req.body ?? {};
    const email = normEmail(b.email);
    if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('Please enter a valid email address.');
    const problem = passwordProblem(b.password);
    if (problem) throw badRequest(problem);
    if (!(b.confirmAdult && b.confirmSingle && b.acceptTerms && b.acceptPrivacy && b.acceptGuidelines && b.sensitiveDataConsent)) {
      throw badRequest('Please confirm each statement and accept the Terms, Privacy Policy, Community Guidelines and sensitive data consent.', 'consent_required');
    }
    if (q.byEmail.get(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    if (isBanned(db, 'email', blindIndex(email))) throw badRequest('We cannot create an account with these details. Please contact support.');

    const user = transaction(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash, role, email_verified) VALUES (?, ?, ?, ?)')
        .run(email, hashPassword(b.password), config().adminEmails.includes(email) ? 'admin' : 'member', config().pilot ? 1 : 0);
      const id = Number(lastInsertRowid);
      const record = db.prepare('INSERT INTO consents (user_id, document, version) VALUES (?, ?, ?)');
      for (const doc of REQUIRED_DOCUMENTS) record.run(id, doc, DOCUMENTS[doc].version);
      record.run(id, SENSITIVE_CONSENT.document, SENSITIVE_CONSENT.version);
      return q.byId.get(id);
    });
    if (!user.email_verified) await sendVerification(user);
    res.status(201).json(session(user));
  });

  app.post('/api/auth/login', limiter.middleware({ name: 'login-ip', max: 30, windowMs: 15 * MIN }), (req, res) => {
    const email = normEmail(req.body?.email);
    const failKey = `login-fail:${email}`;
    if (limiter.count(failKey, LOCKOUT_WINDOW) >= LOCKOUT_FAILURES) return tooMany(res, LOCKOUT_WINDOW / 1000);
    let user = q.byEmail.get(email);
    if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      limiter.hit(failKey, Number.MAX_SAFE_INTEGER, LOCKOUT_WINDOW);
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    limiter.reset(failKey);
    user = promoteIfAdmin(user);
    // Suspended members can still sign in to read the reason and appeal.
    res.json(session(user));
  });

  const GENERIC_FORGOT = { message: 'If an account exists for that email, we have sent a password reset link.' };

  app.post('/api/auth/forgot', limiter.middleware({ name: 'forgot-ip', max: 10, windowMs: 60 * MIN }), async (req, res) => {
    const email = normEmail(req.body?.email);
    const user = q.byEmail.get(email);
    // Same response whether or not the account exists (no account enumeration).
    if (user && limiter.hit(`forgot:${email}`, 3, 60 * MIN).ok) {
      const token = createAuthToken(user.id, 'reset', 60);
      await messenger.email({
        to: user.email,
        subject: 'Reset your Purpose Partner password',
        text: `We received a request to reset your password.\n\nReset it here (link valid for 1 hour):\n${config().appUrl}/#/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    }
    res.json(GENERIC_FORGOT);
  });

  app.post('/api/auth/reset', limiter.middleware({ name: 'reset-ip', max: 20, windowMs: 60 * MIN }), (req, res) => {
    const problem = passwordProblem(req.body?.password);
    if (problem) throw badRequest(problem);
    const row = consumeAuthToken(req.body?.token, 'reset');
    if (!row) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
    // A new password signs out every existing session.
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, email_verified = 1 WHERE id = ?')
      .run(hashPassword(req.body.password), row.user_id);
    res.json(session(q.byId.get(row.user_id)));
  });

  app.post('/api/auth/verify-email', limiter.middleware({ name: 'verify-ip', max: 30, windowMs: 60 * MIN }), (req, res) => {
    const row = consumeAuthToken(req.body?.token, 'verify');
    if (!row) throw badRequest('This verification link is invalid or has expired.');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
    res.json({ verified: true });
  });

  app.post('/api/auth/resend-verification', authBasic, async (req, res) => {
    if (req.user.email_verified) return res.json({ verified: true });
    if (!limiter.hit(`resend:${req.user.id}`, 3, 60 * MIN).ok) return tooMany(res, 600);
    await sendVerification(req.user);
    res.json({ sent: true });
  });

  app.post('/api/auth/change-password', authBasic, (req, res) => {
    if (!verifyPassword(String(req.body?.currentPassword ?? ''), req.user.password_hash)) throw badRequest('Your current password is incorrect.');
    const problem = passwordProblem(req.body?.newPassword);
    if (problem) throw badRequest(problem);
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hashPassword(req.body.newPassword), req.user.id);
    res.json(session(q.byId.get(req.user.id)));
  });

  app.post('/api/auth/logout-all', authSuspended, (req, res) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
    res.status(204).end();
  });

  app.get('/api/me', authSuspended, (req, res) => res.json(members.me(req.user)));
}
