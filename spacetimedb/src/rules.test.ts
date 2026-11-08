// Run: npm test (from spacetimedb/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFacts,
  tierFor,
  escalationFor,
  totalScore,
  decideTick,
  stateAfterCall,
  stateAfterReply,
  ESCALATION_CAP,
  FLAG_BONUS,
  T1_CHECKIN,
  T2_CALL,
  T3_CALL_NOT_PLACED,
  CALL_RESULT_TIMEOUT,
} from './rules.ts';

test('spec example: 82, oxygen, no power → critical', () => {
  const r = scoreFacts({ age: 82, medical: ['oxygen'], hazards: ['no_power'] });
  assert.equal(r.baseScore, 10 + 40 + 20); // no_power +15 does NOT apply with medical dependency
  assert.equal(r.tier, 'critical');
  assert.deepEqual(r.reasons, ['medical: oxygen', 'vulnerable: age 82']);
});

test('empty facts → base 10, normal', () => {
  const r = scoreFacts({});
  assert.equal(r.baseScore, 10);
  assert.equal(r.tier, 'normal');
  assert.deepEqual(r.reasons, []);
});

test('each rule adds its points once', () => {
  assert.equal(scoreFacts({ hazards: ['trapped', 'fire'] }).baseScore, 40);
  assert.equal(scoreFacts({ children: true, age: 90 }).baseScore, 30);
  assert.equal(scoreFacts({ medical: ['mobility'] }).baseScore, 30);
  assert.equal(scoreFacts({ hazards: ['no_power', 'no_water'] }).baseScore, 25);
  assert.equal(scoreFacts({ people: 3 }).baseScore, 20);
  assert.equal(scoreFacts({ people: 2 }).baseScore, 10);
  assert.equal(scoreFacts({ age: 74 }).baseScore, 10);
});

test('everything at once', () => {
  const r = scoreFacts({
    age: 80, people: 4, children: true,
    medical: ['dialysis'], hazards: ['flooding', 'no_power'],
  });
  assert.equal(r.baseScore, 10 + 40 + 30 + 20 + 10);
});

test('tier thresholds', () => {
  assert.equal(tierFor(60), 'critical');
  assert.equal(tierFor(59), 'high');
  assert.equal(tierFor(30), 'high');
  assert.equal(tierFor(29), 'normal');
});

test('escalation +1 per step, capped', () => {
  assert.equal(escalationFor(0n), 0);
  assert.equal(escalationFor(3_500_000n), 3); // demo: 3.5 s
  assert.equal(escalationFor(10_000_000_000n), ESCALATION_CAP);
});

test('a flagged normal case never outranks a confirmed critical one', () => {
  // highest possible normal base is 25 (no_power, no medical)
  const maxNormal = totalScore(25, ESCALATION_CAP, 'flagged');
  const minCritical = totalScore(60, 0, 'waiting');
  assert.ok(maxNormal <= minCritical, `${maxNormal} > ${minCritical}`);
  assert.equal(totalScore(10, 5, 'flagged'), 10 + 5 + FLAG_BONUS);
});

test('tick: waiting → check-in text after T1', () => {
  assert.equal(decideTick('waiting', 'critical', T1_CHECKIN.critical - 1n, null, false), null);
  assert.deepEqual(decideTick('waiting', 'critical', T1_CHECKIN.critical, null, false),
    { state: 'checkin_text_sent', outbox: 'send_text' });
});

test('tick: check-in → call after T2', () => {
  assert.equal(decideTick('checkin_text_sent', 'normal', T2_CALL.normal - 1n, null, false), null);
  assert.deepEqual(decideTick('checkin_text_sent', 'normal', T2_CALL.normal, null, false),
    { state: 'call_placed', outbox: 'place_call' });
});

test('tick: call never placed → flagged after T3', () => {
  assert.equal(decideTick('call_placed', 'high', T3_CALL_NOT_PLACED - 1n, null, false), null);
  assert.deepEqual(decideTick('call_placed', 'high', T3_CALL_NOT_PLACED, null, false), { state: 'flagged' });
  assert.deepEqual(decideTick('call_placed', 'high', T3_CALL_NOT_PLACED, { result: 'failed', ageMicros: 0n }, false),
    { state: 'flagged' });
});

test('tick: call in progress waits for its result', () => {
  const ringing = { result: 'placing', ageMicros: 0n };
  assert.equal(decideTick('call_placed', 'high', T3_CALL_NOT_PLACED * 3n, ringing, false), null);
  assert.deepEqual(decideTick('call_placed', 'high', CALL_RESULT_TIMEOUT, ringing, false), { state: 'flagged' });
});

test('tick: synthetic rows and other states do nothing', () => {
  assert.equal(decideTick('waiting', 'critical', 10n ** 12n, null, true), null);
  for (const s of ['new', 'flagged', 'claimed', 'closed']) {
    assert.equal(decideTick(s, 'critical', 10n ** 12n, null, false), null);
  }
});

test('call results', () => {
  assert.equal(stateAfterCall('answered', '2'), 'closed');
  assert.equal(stateAfterCall('answered', '1'), 'waiting');
  assert.equal(stateAfterCall('answered', ''), 'flagged');
  for (const r of ['no_answer', 'busy', 'failed', 'voicemail']) assert.equal(stateAfterCall(r, ''), 'flagged');
});

test('victim replies', () => {
  assert.equal(stateAfterReply(' 2 '), 'closed');
  assert.equal(stateAfterReply('1'), 'waiting');
  assert.equal(stateAfterReply('water is rising'), 'waiting');
});

// ---------- Storm check-ins ----------
import {
  decideCheckin,
  checkinAfterReply,
  checkinAfterCall,
  S1_RETEXT,
  S2_CALL,
  S3_URGENT,
} from './rules.ts';

test('check-in ladder: text → re-text → call → urgent', () => {
  assert.equal(decideCheckin('texted', S1_RETEXT - 1n, null), null);
  assert.deepEqual(decideCheckin('texted', S1_RETEXT, null), { state: 'retexted', outbox: 'send_text' });
  assert.equal(decideCheckin('retexted', S2_CALL - 1n, null), null);
  assert.deepEqual(decideCheckin('retexted', S2_CALL, null), { state: 'called', outbox: 'place_call' });
  assert.equal(decideCheckin('called', S3_URGENT - 1n, null), null);
  assert.deepEqual(decideCheckin('called', S3_URGENT, null), { state: 'urgent' });
});

test('check-in call: ringing waits, no answer goes urgent', () => {
  assert.equal(decideCheckin('called', S3_URGENT, { result: 'ringing', ageMicros: 0n }), null);
  assert.deepEqual(decideCheckin('called', CALL_RESULT_TIMEOUT, { result: 'ringing', ageMicros: 0n }), { state: 'urgent' });
  assert.deepEqual(decideCheckin('called', S3_URGENT, { result: 'no_answer', ageMicros: 0n }), { state: 'urgent' });
});

test('finished states never move on their own', () => {
  for (const s of ['safe', 'needs_help', 'urgent', 'claimed', 'closed', 'no_reply']) {
    assert.equal(decideCheckin(s, 10n ** 12n, null), null);
  }
});

test('check-in replies and calls', () => {
  assert.equal(checkinAfterReply(' 1 '), 'safe');
  assert.equal(checkinAfterReply('2'), 'needs_help');
  assert.equal(checkinAfterReply('water is rising'), 'needs_help');
  assert.equal(checkinAfterCall('answered', '1'), 'safe');
  assert.equal(checkinAfterCall('answered', '2'), 'needs_help');
  assert.equal(checkinAfterCall('answered', ''), 'urgent');
  assert.equal(checkinAfterCall('no_answer', ''), 'urgent');
});
