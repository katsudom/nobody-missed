// Run: npm test (from spacetimedb/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFacts,
  tierFor,
  levelFor,
  AGE_P3_TO_P2,
  AGE_P2_TO_P1,
  escalationFor,
  totalScore,
  decideTick,
  T1_AFTER_REPLY,
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

test('injury counts as danger, pregnancy as vulnerable', () => {
  assert.deepEqual(scoreFacts({ hazards: ['injury'] }), { baseScore: 40, tier: 'high', reasons: ['danger: injury'] });
  assert.deepEqual(scoreFacts({ medical: ['pregnant'] }), { baseScore: 30, tier: 'high', reasons: ['vulnerable: pregnant'] });
  assert.equal(scoreFacts({ medical: ['pregnant'], hazards: ['flooding'] }).baseScore, 60);
});

test('everything at once', () => {
  const r = scoreFacts({
    age: 80, people: 4, children: true,
    medical: ['dialysis'], hazards: ['flooding', 'no_power'],
  });
  assert.equal(r.baseScore, 10 + 40 + 30 + 20 + 10);
});

test('levels from facts: P1 / P2 / P3', () => {
  // P1: power-dependent medical alone (was amber 50 under the old points)
  assert.equal(scoreFacts({ medical: ['oxygen'], hazards: ['no_power'] }).tier, 'critical');
  // P1: danger AND vulnerable
  assert.equal(scoreFacts({ hazards: ['flooding'], age: 80 }).tier, 'critical');
  // P2: danger alone, or vulnerable alone
  assert.equal(scoreFacts({ hazards: ['trapped'] }).tier, 'high');
  assert.equal(scoreFacts({ children: true }).tier, 'high');
  // P3: utilities only, or nothing
  assert.equal(scoreFacts({ hazards: ['no_power'], people: 4 }).tier, 'normal');
  assert.equal(tierFor({ powerMedical: false, danger: false, vulnerable: false }), 'normal');
});

test('level: unread is at least P2, no contact is P1', () => {
  assert.equal(levelFor('normal', false, 'waiting', 0n), 'high');
  assert.equal(levelFor('critical', false, 'waiting', 0n), 'critical');
  assert.equal(levelFor('normal', true, 'flagged', 0n), 'critical');
});

test('level: waiting moves a report up', () => {
  assert.equal(levelFor('normal', true, 'waiting', AGE_P3_TO_P2 - 1n), 'normal');
  assert.equal(levelFor('normal', true, 'waiting', AGE_P3_TO_P2), 'high');
  assert.equal(levelFor('normal', true, 'waiting', AGE_P3_TO_P2 + AGE_P2_TO_P1 - 1n), 'high');
  assert.equal(levelFor('normal', true, 'waiting', AGE_P3_TO_P2 + AGE_P2_TO_P1), 'critical');
  assert.equal(levelFor('high', true, 'waiting', AGE_P2_TO_P1), 'critical');
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

test('after a "1" reply, the next check-in waits T1_AFTER_REPLY, not the short critical T1', () => {
  assert.equal(decideTick('waiting', 'critical', T1_CHECKIN.critical, null, false, true), null);
  assert.deepEqual(decideTick('waiting', 'critical', T1_AFTER_REPLY, null, false, true),
    { state: 'checkin_text_sent', outbox: 'send_text' });
  // normal tier's own T1 is already longer, so it keeps it
  assert.equal(decideTick('waiting', 'normal', T1_AFTER_REPLY, null, false, true), null);
});

// ---------- Household profile ----------
import { mergeProfile, profileQuestion, followUpText, hasProfile, isSkip } from './rules.ts';

test('profile fills what the message left out and says it came from the file', () => {
  const f = mergeProfile({ hazards: ['no_power'], quotes: ['power is out'] }, { medical: ['oxygen'], people: 2 }, 82);
  assert.equal(f.age, 82);
  assert.equal(f.people, 2);
  assert.deepEqual(f.medical, ['oxygen']);
  assert.deepEqual(f.onFile, ['age 82', '2 people', 'oxygen']);
  assert.equal(scoreFacts(f).tier, 'critical'); // oxygen on file + no power ranks P1 before they say it
});

test('the message wins where both say something', () => {
  const f = mergeProfile({ age: 70, people: 4, medical: ['insulin'] }, { age: 60, people: 2, medical: ['insulin', 'mobility'] });
  assert.equal(f.age, 70);
  assert.equal(f.people, 4);
  assert.deepEqual(f.medical, ['insulin', 'mobility']);
  assert.deepEqual(f.onFile, ['mobility']);
});

test('empty profile changes nothing', () => {
  assert.equal(hasProfile({}), false);
  const f = mergeProfile({ hazards: ['flooding'] }, {});
  assert.deepEqual(f.onFile, []);
  assert.equal(f.age, null);
});

test('follow-up asks the question that fits the household', () => {
  assert.match(profileQuestion({ medical: ['oxygen', 'insulin'] }), /oxygen/);
  assert.match(profileQuestion({ medical: ['dialysis'] }), /dialysis/);
  assert.match(profileQuestion({ medical: ['mobility'] }), /on your own/);
  assert.match(profileQuestion({ children: true }), /kids/);
  assert.match(profileQuestion({}), /anyone hurt/);
  assert.match(followUpText({ medical: ['insulin'] }), /^We got your reply.*insulin.*a few words/);
});

test('SKIP is only the bare word', () => {
  assert.equal(isSkip(' skip '), true);
  assert.equal(isSkip('skip the oxygen part, we have 3 kids'), false);
});
