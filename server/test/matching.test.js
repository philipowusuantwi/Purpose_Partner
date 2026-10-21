import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { compatibility, eligible, ageOn } from '../src/engines/matching.js';
import { scanMessage } from '../src/engines/scam.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

const MAN = { first_name: 'Kwame', gender: 'man', birth_date: '1992-03-10' };

test('compatibility rewards shared faith, values and location', () => {
  const base = { gender: 'woman', age: 30, seeking_age_min: 25, seeking_age_max: 40, denomination: 'Methodist', church_attendance: 'weekly', wants_children: 'yes', marriage_timeline: '1_2_years', drinks: 'never', country: 'Ghana', region: 'Ashanti', city: 'Kumasi' };
  const close = { ...base, gender: 'man', age: 32 };
  const far = { ...close, denomination: 'Catholic', church_attendance: 'occasionally', wants_children: 'no', marriage_timeline: '2_plus_years', drinks: 'occasionally', region: 'Volta', city: 'Ho' };
  const a = compatibility(base, close);
  const b = compatibility(base, far);
  assert.ok(a.score > b.score + 30, `${a.score} vs ${b.score}`);
  assert.ok(a.reasons.includes('Both Methodist'));
  assert.ok(a.score <= 100);
  assert.equal(eligible(base, close), true);
  assert.equal(eligible(base, { ...close, gender: 'woman' }), false);
  assert.equal(eligible(base, { ...close, age: 45 }), false);
  assert.equal(eligible({ ...base, same_denomination: 1 }, far), false);
});

test('age is computed from the birth date', () => {
  assert.equal(ageOn('2000-06-15', new Date('2026-06-14T00:00:00Z')), 25);
  assert.equal(ageOn('2000-06-15', new Date('2026-06-15T00:00:00Z')), 26);
});

test('scam scanner flags money requests and early contact sharing', () => {
  assert.equal(scanMessage('Please can you send me 500 cedis for my hospital bill').risk, 'high');
  assert.equal(scanMessage('Buy me an iTunes gift card').risk, 'high');
  assert.ok(scanMessage('I can teach you forex trading').reasons.includes('crypto'));
  assert.equal(scanMessage('Text me on WhatsApp 0241234567').risk, 'caution');
  assert.equal(scanMessage('Text me on WhatsApp 0241234567', { priorMessages: 100 }).risk, 'none');
  assert.equal(scanMessage('Good morning! How was church today?').risk, 'none');
});

test('discover, mutual interest, match, messages with scam warnings', async () => {
  const ama = await s.member('ama@x.com');
  const kwame = await s.member('kwame@x.com', { profile: MAN });
  const noPhoto = await s.member('nophoto@x.com', { profile: { ...MAN, first_name: 'Kojo' }, photo: false });
  const otherWoman = await s.member('woman2@x.com', { profile: { first_name: 'Abena' } });

  const d = await s.call('GET', '/discover', { token: ama.token });
  assert.equal(d.status, 200);
  const ids = d.body.members.map((m) => m.id);
  assert.ok(ids.includes(kwame.id));
  assert.ok(!ids.includes(noPhoto.id), 'members without an approved photo are not shown');
  assert.ok(!ids.includes(otherWoman.id), 'same gender is not shown');
  const card = d.body.members.find((m) => m.id === kwame.id);
  assert.equal(card.email, undefined);
  assert.equal(card.birthDate, undefined);
  assert.ok(card.compatibility.score > 50);

  const i1 = await s.call('POST', '/interests', { token: ama.token, body: { toId: kwame.id, note: 'Hello!' } });
  assert.deepEqual(i1.body, { matched: false });
  const recv = await s.call('GET', '/interests/received', { token: kwame.token });
  assert.equal(recv.body.count, 1);
  assert.equal(recv.body.members, null, 'free members see the count only');

  const i2 = await s.call('POST', '/interests', { token: kwame.token, body: { toId: ama.id } });
  assert.equal(i2.body.matched, true);
  const matchId = i2.body.matchId;
  assert.ok(!(await s.call('GET', '/discover', { token: ama.token })).body.members.some((m) => m.id === kwame.id));

  const m1 = await s.call('POST', `/matches/${matchId}/messages`, { token: kwame.token, body: { body: 'Good evening Ama, how was your day?' } });
  assert.equal(m1.body.risk, 'none');
  const m2 = await s.call('POST', `/matches/${matchId}/messages`, { token: kwame.token, body: { body: 'I am stuck, please send me money on momo for customs fees' } });
  assert.equal(m2.body.risk, 'high');
  const thread = await s.call('GET', `/matches/${matchId}/messages`, { token: ama.token });
  assert.equal(thread.body.messages.length, 2);
  assert.ok(thread.body.messages[1].warnings.length > 0);
  assert.ok(s.db.prepare("SELECT 1 FROM risk_flags WHERE user_id = ? AND source = 'message'").get(kwame.id));

  const list = await s.call('GET', '/matches', { token: ama.token });
  assert.equal(list.body.matches[0].member.firstName, 'Kwame');

  // Outsiders cannot read the conversation.
  assert.equal((await s.call('GET', `/matches/${matchId}/messages`, { token: otherWoman.token })).status, 404);

  // Courtship stage needs both to agree.
  const p = await s.call('POST', `/matches/${matchId}/stage`, { token: ama.token, body: { stage: 'courtship' } });
  assert.equal(p.body.proposedStage, 'courtship');
  assert.equal((await s.call('POST', `/matches/${matchId}/stage`, { token: kwame.token, body: { stage: 'engaged' } })).status, 400);
  const c = await s.call('POST', `/matches/${matchId}/stage`, { token: kwame.token, body: { stage: 'courtship' } });
  assert.equal(c.body.stage, 'courtship');
});

test('blocking ends the match and hides both members', async () => {
  const a = await s.member('blk-a@x.com');
  const b = await s.member('blk-b@x.com', { profile: MAN });
  await s.call('POST', '/interests', { token: a.token, body: { toId: b.id } });
  const { body } = await s.call('POST', '/interests', { token: b.token, body: { toId: a.id } });
  await s.call('POST', '/blocks', { token: a.token, body: { userId: b.id } });
  assert.equal((await s.call('POST', `/matches/${body.matchId}/messages`, { token: b.token, body: { body: 'hi' } })).status, 400);
  assert.equal((await s.call('GET', `/members/${a.id}`, { token: b.token })).status, 404);
  assert.equal((await s.call('GET', '/matches', { token: b.token })).body.matches.length, 0);
});

test('free members have a daily interest limit; Premium removes it and shows who is interested', async () => {
  process.env.PP_FREE_DAILY_INTERESTS = '1';
  try {
    const w = await s.member('limit@x.com');
    const m1 = await s.member('lim-m1@x.com', { profile: MAN });
    const m2 = await s.member('lim-m2@x.com', { profile: MAN });
    assert.equal((await s.call('POST', '/interests', { token: w.token, body: { toId: m1.id } })).status, 201);
    const blocked = await s.call('POST', '/interests', { token: w.token, body: { toId: m2.id } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'premium_required');
    assert.equal((await s.call('POST', '/interests', { token: w.token, body: { toId: m2.id, kind: 'pass' } })).status, 201, 'passing is always allowed');

    const co = await s.call('POST', '/billing/checkout', { token: m1.token, body: { plan: 'premium_monthly' } });
    assert.equal(co.body.provider, 'sandbox');
    const paid = await s.call('POST', '/billing/sandbox/complete', { token: m1.token, body: { reference: co.body.reference } });
    assert.ok(paid.body.premiumUntil);
    const recv = await s.call('GET', '/interests/received', { token: m1.token });
    assert.equal(recv.body.members[0].id, w.id);
  } finally {
    delete process.env.PP_FREE_DAILY_INTERESTS;
  }
});
