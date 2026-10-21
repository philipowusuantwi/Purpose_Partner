// Runtime configuration, read from the environment on each call so tests can override it.
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function config() {
  const env = process.env;
  const pilot = env.PP_PILOT === '1';
  return {
    production: env.NODE_ENV === 'production',
    // Pilot mode: for a small invited test group before email, SMS and payments are connected.
    // New accounts are treated as email-verified, OTP codes are shown in the app and test
    // (sandbox) payments are allowed.
    pilot,
    appUrl: (env.PP_APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    adminEmails: (env.PP_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    minAge: num(env.PP_MIN_AGE, 18),
    currency: env.PP_CURRENCY || 'GHS',
    plans: {
      premium_monthly: { label: 'Premium monthly', amountMinor: num(env.PP_PRICE_MONTHLY, 5000), days: 30 },
      premium_annual: { label: 'Premium annual', amountMinor: num(env.PP_PRICE_ANNUAL, 45000), days: 365 },
    },
    freeDailyInterests: num(env.PP_FREE_DAILY_INTERESTS, 10),
    autoHideReports: num(env.PP_AUTO_HIDE_REPORTS, 3),
    registerPerHourPerIp: num(env.PP_REGISTER_PER_HOUR, 30),
    paystackSecret: env.PAYSTACK_SECRET_KEY || null,
    allowSandboxPayments: env.NODE_ENV !== 'production' || pilot || env.PP_ALLOW_SANDBOX === '1',
    mailWebhook: env.PP_MAIL_WEBHOOK || null,
    smsWebhook: env.PP_SMS_WEBHOOK || null,
  };
}
