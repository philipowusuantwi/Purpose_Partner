import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, CONSENTS } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

test('export contains the member\'s data and no other secrets', async () => {
  const m = await s.member('export@x.com');
  const r = await s.call('GET', '/account/export', { token: m.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.account.email, 'export@x.com');
  assert.equal(r.body.profile.first_name, 'Ama');
  assert.equal(JSON.stringify(r.body).includes('password_hash'), false);
  assert.ok(r.body.consents.length >= 4);
});

test('pausing hides the profile from Discover', async () => {
  const w = await s.member('pause@x.com');
  const man = await s.member('pause-m@x.com', { profile: { first_name: 'Yaw', gender: 'man', birth_date: '1990-01-01' } });
  await s.call('PUT', '/account/visibility', { token: w.token, body: { visible: false } });
  assert.ok(!(await s.call('GET', '/discover', { token: man.token })).body.members.some((x) => x.id === w.id));
});

test('deleting an account erases it; removed suspended members cannot sign up again', async () => {
  const m = await s.member('gone@x.com');
  assert.equal((await s.call('DELETE', '/account', { token: m.token, body: { password: 'wrong-password' } })).status, 400);
  assert.equal((await s.call('DELETE', '/account', { token: m.token, body: { password: 'faithfulheart' } })).status, 204);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(m.id).n, 0);
  const again = await s.call('POST', '/auth/register', { body: { email: 'gone@x.com', password: 'faithfulheart', ...CONSENTS } });
  assert.equal(again.status, 201, 'members in good standing may return');

  const bad = await s.member('banned@x.com');
  s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(bad.id);
  assert.equal((await s.call('DELETE', '/account', { token: bad.token, body: { password: 'faithfulheart' } })).status, 204);
  const back = await s.call('POST', '/auth/register', { body: { email: 'banned@x.com', password: 'faithfulheart', ...CONSENTS } });
  assert.equal(back.status, 400);
});

test('legal documents are served with their review status', async () => {
  const r = await s.call('GET', '/legal/terms');
  assert.equal(r.status, 200);
  assert.match(r.body.status, /DRAFT/);
});
