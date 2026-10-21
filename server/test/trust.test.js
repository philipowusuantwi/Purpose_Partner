import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PNG } from './helpers.js';
import { tierFor } from '../src/engines/integrity.js';

let s;
let admin;
before(async () => {
  s = await startServer();
  admin = await s.staff('analyst@pp.test', 'trust_analyst');
});
after(() => s.close());

const step = (trust, id) => trust.report.steps.find((x) => x.id === id).status;

test('tiers follow the concept note thresholds', () => {
  assert.equal(tierFor(95).id, 'platinum');
  assert.equal(tierFor(75).id, 'gold');
  assert.equal(tierFor(60).id, 'silver');
  assert.equal(tierFor(40).id, 'bronze');
  assert.equal(tierFor(39).id, 'limited');
});

test('phone OTP verifies a number and blocks reuse on another account', async () => {
  const m = await s.member('otp@x.com');
  const send = await s.call('POST', '/verify/phone/send', { token: m.token, body: { phone: '024 123 4567' } });
  assert.equal(send.status, 200);
  const code = s.lastSmsCode('+233241234567');
  assert.match(code, /^\d{6}$/);
  const wrong = await s.call('POST', '/verify/phone/confirm', { token: m.token, body: { code: code === '000000' ? '111111' : '000000' } });
  assert.equal(wrong.status, 400);
  const ok = await s.call('POST', '/verify/phone/confirm', { token: m.token, body: { code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.phoneVerified, true);
  assert.equal(ok.body.user.phone, '+233241234567');

  const other = await s.member('otp2@x.com');
  const dup = await s.call('POST', '/verify/phone/send', { token: other.token, body: { phone: '+233241234567' } });
  assert.equal(dup.status, 409);
});

test('Ghana Card review: duplicate detection, approval erases images', async () => {
  const m = await s.member('card@x.com');
  const bad = await s.call('POST', '/uploads/ghana-card', { token: m.token, body: { cardNumber: '12345', front: PNG, back: PNG, consent: true } });
  assert.equal(bad.status, 400);
  const noConsent = await s.call('POST', '/uploads/ghana-card', { token: m.token, body: { cardNumber: 'GHA-123456789-0', front: PNG, back: PNG } });
  assert.equal(noConsent.body.code, 'consent_required');
  const ok = await s.call('POST', '/uploads/ghana-card', { token: m.token, body: { cardNumber: 'gha-123456789-0', front: PNG, back: PNG, consent: true } });
  assert.equal(ok.status, 201);
  const again = await s.call('POST', '/uploads/ghana-card', { token: m.token, body: { cardNumber: 'GHA-123456789-0', front: PNG, back: PNG, consent: true } });
  assert.equal(again.status, 400);

  const row = s.db.prepare('SELECT * FROM verifications WHERE id = ?').get(ok.body.id);
  assert.ok(!row.payload_enc.includes('GHA-123456789-0'), 'card number is encrypted at rest');
  assert.equal(JSON.parse(row.meta).masked, 'GHA-*****6789-0');

  // Moderators cannot see identity documents.
  const mod = await s.staff('mod@pp.test', 'moderator');
  assert.equal((await s.call('GET', `/staff/verifications/${ok.body.id}`, { token: mod.token })).status, 403);

  const detail = await s.call('GET', `/staff/verifications/${ok.body.id}`, { token: admin.token });
  assert.equal(detail.body.submission.cardNumber, 'GHA-123456789-0');
  const dec = await s.call('POST', `/staff/verifications/${ok.body.id}`, { token: admin.token, body: { decision: 'approve' } });
  assert.equal(dec.status, 200);
  assert.equal(s.db.prepare('SELECT payload_enc FROM verifications WHERE id = ?').get(ok.body.id).payload_enc, null);

  // The same card on a second account raises a high-risk flag and cannot be approved.
  const imp = await s.member('impostor@x.com');
  const second = await s.call('POST', '/uploads/ghana-card', { token: imp.token, body: { cardNumber: 'GHA-123456789-0', front: PNG, back: PNG, consent: true } });
  assert.equal(second.status, 201);
  const flags = await s.call('GET', '/staff/flags', { token: admin.token });
  assert.ok(flags.body.items.some((f) => f.source === 'duplicate_document' && f.member.id === imp.id));
  const blocked = await s.call('POST', `/staff/verifications/${second.body.id}`, { token: admin.token, body: { decision: 'approve' } });
  assert.equal(blocked.status, 409);
});

test('full trust stack earns the Marriage Transparency Shield', async () => {
  const m = await s.member('shield@x.com');
  let t = await s.call('GET', '/trust', { token: m.token });
  assert.equal(t.body.report.shield, false);
  assert.equal(step(t.body, 'ghana_card'), 'todo');

  for (const [path, body] of [['/uploads/ghana-card', { cardNumber: 'GHA-987654321-1', front: PNG, back: PNG, consent: true }], ['/uploads/liveness', { selfie: PNG }]]) {
    assert.equal((await s.call('POST', path, { token: m.token, body })).status, 201);
  }
  const queue = await s.call('GET', '/staff/verifications', { token: admin.token });
  for (const v of queue.body.items.filter((x) => x.member.id === m.id)) {
    await s.call('POST', `/staff/verifications/${v.id}`, { token: admin.token, body: { decision: 'approve' } });
  }
  assert.equal((await s.call('POST', '/verify/status', { token: m.token, body: { status: 'never_married' } })).status, 400);
  assert.equal((await s.call('POST', '/verify/status', { token: m.token, body: { status: 'never_married', confirmNotMarried: true } })).status, 200);

  // Church: register, approve, member claims, pastor confirms.
  const pastor = await s.member('pastor@x.com', { profile: { first_name: 'Samuel', gender: 'man', birth_date: '1975-01-01' } });
  const ch = await s.call('POST', '/churches', { token: pastor.token, body: { name: 'Bethel Assembly', denomination: 'Assemblies of God', city: 'Accra', region: 'Greater Accra', title: 'Pastor' } });
  assert.equal(ch.status, 201);
  assert.equal((await s.call('GET', `/church-portal/${ch.body.id}`, { token: pastor.token })).status, 403);
  const boss = await s.staff('boss@pp.test', 'admin');
  await s.call('POST', `/admin/churches/${ch.body.id}`, { token: boss.token, body: { decision: 'approve' } });
  assert.equal((await s.call('POST', '/church-membership', { token: m.token, body: { churchId: ch.body.id, memberSince: 2015 } })).status, 201);
  const portal = await s.call('GET', `/church-portal/${ch.body.id}`, { token: pastor.token });
  assert.equal(portal.body.pending.length, 1);
  assert.equal(portal.body.pending[0].declaredStatus, 'never_married');
  const conf = await s.call('POST', `/church-portal/${ch.body.id}/memberships/${m.id}`, { token: pastor.token, body: { decision: 'confirm', statusAttested: 'confirms_single' } });
  assert.equal(conf.status, 200);

  // Reference.
  await s.call('POST', '/verify/references', { token: m.token, body: { name: 'Auntie Esi', email: 'esi@x.com', relationship: 'Family friend' } });
  const token = s.mailedToken('esi@x.com', 'reference');
  const info = await s.call('GET', `/references/${token}`);
  assert.equal(info.body.memberFirstName, 'Ama');
  const done = await s.call('POST', `/references/${token}`, { body: { knownYears: 10, honesty: 5, kindness: 5, faithfulness: 4, confirmsSingle: 'yes', recommend: true } });
  assert.equal(done.status, 200);
  assert.equal((await s.call('GET', `/references/${token}`)).status, 404, 'links are single-use');

  t = await s.call('GET', '/trust', { token: m.token });
  assert.equal(t.body.report.shield, true);
  assert.equal(t.body.report.identityVerified, true);
  assert.equal(t.body.report.statusConfirmed, true);
  // identity 30 (no phone: 25) + relationship 20 + behaviour 25 + community 11 + stability 2
  assert.equal(t.body.report.score, 25 + 20 + 25 + 11 + 2);
  assert.equal(t.body.report.tier, 'gold');
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action = 'church.membership.confirm'").get());
});

test('a reference saying the member is not single raises a high-risk flag', async () => {
  const m = await s.member('liar@x.com');
  await s.call('POST', '/verify/references', { token: m.token, body: { name: 'Neighbour', email: 'nb@x.com', relationship: 'Neighbour' } });
  await s.call('POST', `/references/${s.mailedToken('nb@x.com', 'reference')}`, { body: { knownYears: 3, honesty: 2, kindness: 3, faithfulness: 1, confirmsSingle: 'no', recommend: false } });
  const flag = s.db.prepare("SELECT * FROM risk_flags WHERE user_id = ? AND source = 'reference'").get(m.id);
  assert.equal(flag.level, 'high');
});

test('readiness assessment returns educational scores', async () => {
  const m = await s.member('ready@x.com');
  const q = await s.call('GET', '/readiness', { token: m.token });
  assert.ok(q.body.questions.length >= 20);
  assert.equal((await s.call('POST', '/readiness', { token: m.token, body: { answers: { o1: 3 } } })).status, 400);
  const answers = Object.fromEntries(q.body.questions.map((x) => [x.id, 4]));
  const r = await s.call('POST', '/readiness', { token: m.token, body: { answers } });
  assert.equal(r.status, 201);
  assert.ok(r.body.result.overall >= 0 && r.body.result.overall <= 100);
  assert.ok(['secure', 'anxious', 'avoidant', 'fearful'].includes(r.body.result.attachment));
  assert.match(r.body.disclaimer, /not a psychological/);
});
