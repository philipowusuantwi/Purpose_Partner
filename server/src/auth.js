import crypto from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

let warned = false;
export function secret() {
  const s = process.env.PP_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PP_SECRET must be set in production');
  }
  if (!warned) {
    console.warn('[auth] PP_SECRET not set - using an insecure development secret');
    warned = true;
  }
  return 'purpose-partner-dev-secret';
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200; // bounds scrypt work per request

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > PASSWORD_MAX) return false;
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Session token bound to the user's token_version, so bumping it revokes every session. */
export function issueToken(user) {
  const body = b64url(JSON.stringify({ sub: user.id, v: user.token_version ?? 0, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const { sub, v, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isInteger(sub) || exp < Date.now() / 1000) return null;
    return { userId: sub, version: v ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Authenticates the bearer token. Suspended members are refused unless `allowSuspended`
 * (used for /me and appeals, so they can see why and ask for a review).
 */
export function requireAuth(db, { allowSuspended = false } = {}) {
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const touch = db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ? AND (last_active_at IS NULL OR last_active_at < datetime('now', '-5 minutes'))");
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const claims = verifyToken(header.replace(/^Bearer\s+/i, ''));
    const user = claims && getUser.get(claims.userId);
    if (!user || user.token_version !== claims.version) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (user.status === 'suspended' && !allowSuspended) {
      return res.status(403).json({ error: 'This account has been suspended. You can appeal from the app.', code: 'suspended' });
    }
    touch.run(user.id);
    req.user = user;
    next();
  };
}

export const STAFF_ROLES = ['moderator', 'trust_analyst', 'admin'];

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'You do not have access to this area.' });
    next();
  };
}
