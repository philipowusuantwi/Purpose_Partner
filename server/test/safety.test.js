import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
let mod;
before(async () => {
  s = await startServer();
  mod = await s.staff('mod@pp.test', 'moderator');
});
after(() => s.close());

const MAN = { first_name: 'Kofi', gender: 'man', birth_date: '1990-01-01' };

test('three reports hide a profile until reviewed; upheld reports lower the score and can suspend', async () => {
  const target = await s.member('target@x.com', { profile: MAN });
  const before = (await s.call('GET', '/trust', { token: target.token })).body.report.score;
  const reporters = [];
  for (let i = 0; i < 3; i++) {
    const r = await s.member(`rep${i}@x.com`);
    reporters.push(r);
    assert.equal((await s.call('POST', '/reports', { token: r.token, body: { userId: target.id, reason: 'scam', details: 'Asked for money' } })).status, 201);
  }
  const fresh = await s.member('fresh@x.com');
  assert.ok(!(await s.call('GET', '/discover', { token: fresh.token })).body.members.some((m) => m.id === target.id));

  const reports = await s.call('GET', '/staff/reports', { token: mod.token });
  const [first, ...rest] = reports.body.items.filter((r) => r.member.id === target.id);
  await s.call('POST', `/staff/reports/${first.id}`, { token: mod.token, body: { decision: 'uphold', resolution: 'Scam confirmed' } });
  const after1 = (await s.call('GET', '/trust', { token: target.token })).body.report.score;
  assert.equal(before - after1, 10);

  await s.call('POST', `/staff/reports/${rest[0].id}`, { token: mod.token, body: { decision: 'uphold', resolution: 'Repeated scam attempts', suspend: true } });
  const blocked = await s.call('GET', '/discover', { token: target.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'suspended');

  // Suspended members can still sign in, see why, and appeal.
  const me = await s.call('GET', '/me', { token: target.token });
  assert.equal(me.body.user.status, 'suspended');
  assert.equal(me.body.user.suspendedReason, 'Repeated scam attempts');
  assert.equal((await s.call('POST', '/appeals', { token: target.token, body: { body: 'too short' } })).status, 400);
  assert.equal((await s.call('POST', '/appeals', { token: target.token, body: { body: 'I believe this was a misunderstanding; please review my messages.' } })).status, 201);
  const appeals = await s.call('GET', '/staff/appeals', { token: mod.token });
  const a = appeals.body.items.find((x) => x.member.id === target.id);
  await s.call('POST', `/staff/appeals/${a.id}`, { token: mod.token, body: { decision: 'reinstate', note: 'Reinstated on review' } });
  assert.equal((await s.call('GET', '/discover', { token: target.token })).status, 200);
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action = 'appeal.reinstate'").get());
});

test('members cannot report messages from conversations they are not in', async () => {
  const a = await s.member('ra@x.com');
  const b = await s.member('rb@x.com', { profile: MAN });
  await s.call('POST', '/interests', { token: a.token, body: { toId: b.id } });
  const { body } = await s.call('POST', '/interests', { token: b.token, body: { toId: a.id } });
  const msg = await s.call('POST', `/matches/${body.matchId}/messages`, { token: b.token, body: { body: 'Hello' } });
  const outsider = await s.member('rc@x.com');
  const r = await s.call('POST', '/reports', { token: outsider.token, body: { userId: b.id, reason: 'harassment', messageId: msg.body.id } });
  assert.equal(r.status, 400);
  const ok = await s.call('POST', '/reports', { token: a.token, body: { userId: b.id, reason: 'harassment', messageId: msg.body.id, block: true } });
  assert.equal(ok.status, 201);
  assert.equal((await s.call('GET', '/matches', { token: a.token })).body.matches.length, 0);
});

test('safe meet-up plan notifies the trusted contact, with check-in and emergency alert', async () => {
  const m = await s.member('date@x.com');
  const missing = await s.call('POST', '/safety-plans', { token: m.token, body: { place: 'Accra Mall', startsAt: '2030-01-01T15:00:00Z', contactName: 'Sister' } });
  assert.equal(missing.status, 400);
  const p = await s.call('POST', '/safety-plans', { token: m.token, body: { place: 'Accra Mall food court', startsAt: '2030-01-01T15:00:00Z', contactName: 'Sister Abena', contactEmail: 'abena@x.com', contactPhone: '0201234567' } });
  assert.equal(p.status, 201);
  const mail = s.db.prepare("SELECT * FROM outbox WHERE recipient = 'abena@x.com' ORDER BY id DESC").get();
  assert.match(mail.body, /Accra Mall food court/);
  assert.ok(s.db.prepare("SELECT 1 FROM outbox WHERE channel = 'sms' AND recipient = '+233201234567'").get());
  await s.call('POST', `/safety-plans/${p.body.id}/alert`, { token: m.token });
  assert.match(s.db.prepare("SELECT subject FROM outbox WHERE recipient = 'abena@x.com' ORDER BY id DESC").get().subject, /URGENT/);
  const plans = await s.call('GET', '/safety-plans', { token: m.token });
  assert.equal(plans.body.plans[0].status, 'alert');
});

test('photos need approval before others see them', async () => {
  const m = await s.member('pics@x.com', { photo: false });
  const up = await s.call('POST', '/uploads/photo', { token: m.token, body: { data: 'data:image/png;base64,AAAA' } });
  assert.equal(up.status, 400);
  const { PNG } = await import('./helpers.js');
  const ok = await s.call('POST', '/uploads/photo', { token: m.token, body: { data: PNG } });
  assert.equal(ok.status, 201);
  const viewer = await s.member('viewer@x.com', { profile: MAN });
  assert.equal((await s.call('GET', `/members/${m.id}`, { token: viewer.token })).body.member.photos.length, 0);
  await s.call('POST', `/staff/photos/${ok.body.id}`, { token: mod.token, body: { decision: 'approve' } });
  assert.equal((await s.call('GET', `/members/${m.id}`, { token: viewer.token })).body.member.photos.length, 1);
});

test('staff areas are restricted', async () => {
  const m = await s.member('nosy@x.com');
  assert.equal((await s.call('GET', '/staff/overview', { token: m.token })).status, 403);
  assert.equal((await s.call('GET', '/admin/stats', { token: mod.token })).status, 403);
  assert.equal((await s.call('GET', '/staff/flags', { token: mod.token })).status, 403);
});
