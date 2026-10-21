import express from 'express';
import { requireAuth, requireRole } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { isValidDate } from './validation.js';
import { createRateLimiter } from './services/rateLimit.js';
import { createMessenger } from './services/messenger.js';
import { createNotifier } from './services/notifier.js';
import { createAudit } from './services/audit.js';
import { createMembers } from './services/members.js';
import { createPayments } from './services/payments.js';
import { createTrust } from './engines/integrity.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import profileRoutes from './routes/profile.js';
import verificationRoutes from './routes/verification.js';
import matchRoutes from './routes/matches.js';
import safetyRoutes from './routes/safety.js';
import churchRoutes from './routes/churches.js';
import communityRoutes from './routes/community.js';
import staffRoutes from './routes/staff.js';
import adminRoutes from './routes/admin.js';
import billingRoutes from './routes/billing.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (config().production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function createApp(db, { limiter = createRateLimiter() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (e.g. Railway) so rate limits see each visitor's real IP.
  // A hop count must be passed as a number: Express treats the string "1" as an IP address.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' || trustProxy);
  app.use(securityHeaders);

  const notifier = createNotifier(db);
  const trust = createTrust(db);
  const members = createMembers(db, trust);
  const authenticate = requireAuth(db);

  /** Blocks the app until every required legal document version is accepted. */
  const requireConsent = (req, res, next) => {
    const missing = members.missingConsents(req.user.id);
    if (missing.length) {
      return res.status(403).json({ error: 'Please review and accept the updated terms to continue.', code: 'consent_required', documents: missing });
    }
    next();
  };
  /** Matching features need a completed profile. */
  const requireProfile = (req, res, next) => (members.profile(req.user.id) ? next()
    : res.status(403).json({ error: 'Please complete your profile first.', code: 'profile_required' }));

  const ctx = {
    db,
    config,
    limiter,
    notifier,
    trust,
    members,
    audit: createAudit(db),
    messenger: createMessenger(db),
    payments: createPayments(db, { notifier }),
    authBasic: authenticate,
    authSuspended: requireAuth(db, { allowSuspended: true }),
    auth: [authenticate, requireConsent],
    member: [authenticate, requireConsent, requireProfile],
    requireRole,
    /** Large JSON bodies for image uploads (photos, Ghana Card, selfies). */
    uploads: express.json({ limit: '8mb' }),
    /** The member's local calendar date; the client sends ?today=YYYY-MM-DD. */
    today: (req) => {
      const t = req.query.today ?? req.body?.today;
      return isValidDate(t) ? t : todayUtc();
    },
  };

  // Payment webhooks need the raw body for signature verification - mount before JSON parsing.
  billingRoutes.webhooks(app, ctx);
  // Upload routes parse their own (larger) bodies.
  app.use((req, res, next) => (req.path.startsWith('/api/uploads/') ? next() : express.json({ limit: '200kb' })(req, res, next)));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, pilot: config().pilot, payments: ctx.payments.provider() });
  });

  for (const routes of [authRoutes, accountRoutes, profileRoutes, verificationRoutes, matchRoutes, safetyRoutes,
    churchRoutes, communityRoutes, staffRoutes, adminRoutes, billingRoutes]) {
    routes(app, ctx);
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
