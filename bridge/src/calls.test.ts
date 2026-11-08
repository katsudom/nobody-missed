import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCheckinCall } from './calls.ts';

const agent = (message: string | null) => ({ role: 'agent' as const, message });
const user = (message: string | null) => ({ role: 'user' as const, message });

const QUESTION = agent('If you are safe, press 1 or say I\'m safe. If you are not safe, press 2 or say help.');
const MENU = agent('Press 1 or say report if you want to file a report. Press 2 or say dispatch if you want someone dispatched to you.');
const ASK = agent('Please briefly tell us what happened.');
const FILED = agent('Okay, we have filed your report, thank you.');
const SENDING = agent('Okay, someone will be sent your way to help.');

test('safe on the first question', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('1'), agent('Thank you. You are marked safe.')]), { dtmf: '1', report: '' });
  assert.deepEqual(readCheckinCall([QUESTION, user("I'm safe."), agent('Thank you. You are marked safe.')]), { dtmf: '1', report: '' });
});

test('help, then someone dispatched: no report', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('2'), MENU, user('2'), SENDING]), { dtmf: '2', report: '' });
});

test('help, then a report: the 1 at the menu is not "safe", and the words are kept', () => {
  assert.deepEqual(
    readCheckinCall([QUESTION, user('2'), MENU, user('1'), ASK, user('A tree came through the roof.'), FILED, agent(null), user('2')]),
    { dtmf: '2', report: 'A tree came through the roof.' }
  );
});

test('a report split over two turns is joined, silence and stray keys dropped', () => {
  assert.deepEqual(
    readCheckinCall([QUESTION, user('Help.'), MENU, user('1'), ASK, user('...'), user('Mom is 82,'), user('3'), user("on oxygen, power's out."), FILED]),
    { dtmf: '2', report: "Mom is 82, on oxygen, power's out." }
  );
});

test('hanging up mid-report still keeps what they said', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('2'), MENU, user('1'), ASK, user('The water is rising')]), { dtmf: '2', report: 'The water is rising' });
});

test('asked for a report but said nothing: no report, still help', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('2'), MENU, user('1'), ASK, user('...'), SENDING]), { dtmf: '2', report: '' });
});

test('hearing the menu can never come back safe, even if the first answer looked like 1', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('1'), MENU, user('2'), SENDING]), { dtmf: '2', report: '' });
});

test('no clear answer stays unanswered', () => {
  assert.deepEqual(readCheckinCall([QUESTION, user('...'), QUESTION, user('...'), SENDING]), { dtmf: '', report: '' });
  assert.deepEqual(readCheckinCall([QUESTION, user('so anyway we should head over to the booth now')]), { dtmf: '', report: '' });
});
