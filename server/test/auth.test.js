import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, CONSENTS, PROFILE } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

test('registration requires every consent and statement', async () => {
  const r = await s.call('POST', '/auth/register', { body: { email: 'a@x.com', password: 'faithfulheart', ...CONSENTS, confirmSingle: false } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'consent_required');
});

test('register, verify email, sign in and record consents', async () => {
  const reg = await s.call('POST', '/auth/register', { body: { email: 'Grace@Example.com', password: 'faithfulheart', ...CONSENTS } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'grace@example.com');
  assert.equal(reg.body.user.emailVerified, false);
  assert.equal(reg.body.user.onboarded, false);
  const docs = s.db.prepare('SELECT document FROM consents WHERE user_id = ?').all(reg.body.user.id).map((r) => r.document).sort();
  assert.deepEqual(docs, ['guidelines', 'privacy', 'sensitive_data', 'terms']);

  const v = await s.call('POST', '/auth/verify-email', { body: { token: s.mailedToken('grace@example.com', 'verify-email') } });
  assert.equal(v.status, 200);
  const login = await s.call('POST', '/auth/login', { body: { email: 'grace@example.com', password: 'faithfulheart' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.emailVerified, true);

  const dup = await s.call('POST', '/auth/register', { body: { email: 'grace@example.com', password: 'faithfulheart', ...CONSENTS } });
  assert.equal(dup.status, 409);
});

test('profile requires adults and valid choices', async () => {
  const m = await s.member('young@x.com', { profile: null });
  const minor = new Date();
  minor.setUTCFullYear(minor.getUTCFullYear() - 17);
  const r = await s.call('PUT', '/profile', { token: m.token, body: { ...PROFILE, birth_date: minor.toISOString().slice(0, 10) } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /at least 18/);
  const bad = await s.call('PUT', '/profile', { token: m.token, body: { ...PROFILE, denomination: 'Made up' } });
  assert.equal(bad.status, 400);
  const ok = await s.call('PUT', '/profile', { token: m.token, body: PROFILE });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.onboarded, true);
  const upd = await s.call('PUT', '/profile', { token: m.token, body: { about: 'Updated', city: 'Tema' } });
  assert.equal(upd.body.profile.about, 'Updated');
  assert.equal(upd.body.profile.city, 'Tema');
  assert.equal(upd.body.profile.gender, 'woman');
});

test('wrong passwords lock the account temporarily', async () => {
  await s.member('lock@x.com', { profile: null });
  for (let i = 0; i < 10; i++) await s.call('POST', '/auth/login', { body: { email: 'lock@x.com', password: 'nope-nope' } });
  const r = await s.call('POST', '/auth/login', { body: { email: 'lock@x.com', password: 'faithfulheart' } });
  assert.equal(r.status, 429);
});

test('password reset revokes old sessions', async () => {
  const m = await s.member('reset@x.com', { profile: null });
  await s.call('POST', '/auth/forgot', { body: { email: 'reset@x.com' } });
  const r = await s.call('POST', '/auth/reset', { body: { token: s.mailedToken('reset@x.com', 'reset-password'), password: 'newfaithful1' } });
  assert.equal(r.status, 200);
  assert.equal((await s.call('GET', '/me', { token: m.token })).status, 401);
  assert.equal((await s.call('GET', '/me', { token: r.body.token })).status, 200);
});

test('security headers are set and unknown API routes 404', async () => {
  const r = await s.call('GET', '/nope');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
