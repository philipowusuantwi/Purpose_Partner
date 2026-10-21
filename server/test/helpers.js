import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

process.env.PP_QUIET_MAIL = '1';
// Many sign-ups from one test IP; the limit itself is covered in security.test.js.
process.env.PP_REGISTER_PER_HOUR ??= '10000';

export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const CONSENTS = { confirmAdult: true, confirmSingle: true, acceptTerms: true, acceptPrivacy: true, acceptGuidelines: true, sensitiveDataConsent: true };

export const PROFILE = {
  first_name: 'Ama', gender: 'woman', birth_date: '1995-06-03', region: 'Greater Accra', city: 'Accra',
  denomination: 'Pentecostal', church_attendance: 'weekly', wants_children: 'yes', marriage_timeline: '1_2_years',
  drinks: 'never', about: 'Joyful and family-oriented.', seeking_age_min: 22, seeking_age_max: 55,
};

export async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp(db);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { token, body, raw, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }

  /** Latest link token emailed to `recipient` for `kind` ('verify-email' | 'reset-password' | 'reference'). */
  function mailedToken(recipient, kind) {
    const mail = db.prepare('SELECT body FROM outbox WHERE recipient = ? AND body LIKE ? ORDER BY id DESC LIMIT 1').get(recipient, `%${kind}%`);
    return mail?.body.match(new RegExp(`${kind}\\?token=([\\w-]+)`))?.[1];
  }

  const lastSmsCode = (phone) => db.prepare("SELECT body FROM outbox WHERE channel = 'sms' AND recipient = ? ORDER BY id DESC LIMIT 1").get(phone)?.body.match(/\d{6}/)?.[0];

  /**
   * Register, verify email and create a profile with an approved photo (so they appear in
   * Discover). Returns {token, id, email}.
   */
  async function member(email, { profile = {}, verify = true, photo = true } = {}) {
    const reg = await call('POST', '/auth/register', { body: { email, password: 'faithfulheart', ...CONSENTS } });
    if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
    const { token } = reg.body;
    const id = reg.body.user.id;
    if (verify) await call('POST', '/auth/verify-email', { body: { token: mailedToken(email, 'verify-email') } });
    if (profile !== null) {
      const p = await call('PUT', '/profile', { token, body: { ...PROFILE, ...profile } });
      if (p.status !== 200) throw new Error(`profile failed: ${JSON.stringify(p.body)}`);
      if (photo) db.prepare("INSERT INTO photos (user_id, data, status) VALUES (?, ?, 'approved')").run(id, PNG);
    }
    return { token, id, email };
  }

  async function staff(email, role = 'admin') {
    const s = await member(email, { profile: null });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, s.id);
    return s;
  }

  return { db, call, member, staff, mailedToken, lastSmsCode, close: () => server.close() };
}
