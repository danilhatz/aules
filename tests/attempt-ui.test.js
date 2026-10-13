import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { MoodleError } from '../src/api.js';
import { parseQuiz } from '../src/quiz.js';
import { mcqHtml, tfHtml, shortHtml } from './fixtures.js';

setupDom();
const { renderAttempt, renderReview } = await import('../src/ui/attempt.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

const quiz = parseQuiz({ id: 3, coursemodule: 10, name: 'Test 1', grade: 10, sumgrades: 4 });
const qs = () => [
  { slot: 1, number: 1, type: 'multichoice', html: mcqHtml(5, 1) },
  { slot: 2, number: 2, type: 'truefalse', html: tfHtml(6, 2) },
  { slot: 3, number: 3, type: 'shortanswer', html: shortHtml(7, 3) },
];

function mk(over = {}) {
  const calls = [];
  const done = []; const nav = []; const snaps = [];
  let tickFn = null;
  let stopped = false;
  const clockNow = { v: 1000 };
  const props = {
    courseId: 11, cmid: 10, quiz, page: 1, nextPage: 2, sequential: false, questions: qs(), endTime: 0,
    clock: { now: () => clockNow.v, every: (fn) => { tickFn = fn; return 1; }, stop: () => { stopped = true; } },
    snapshot: null, token: 'T', openUrl: 'https://aules.edu.gva.es/fpa/mod/quiz/view.php?id=10',
    actions: {
      save: async (a) => { calls.push(['save', a]); },
      go: async (a, page) => { calls.push(['go', a, page]); },
      loadSummary: async () => ({ total: 3, answered: 2 }),
      finish: async (a, o) => { calls.push(['finish', a, o]); },
    },
    onSnapshot: (s) => snaps.push(s), onNavigate: (p) => nav.push(p), onDone: (k) => done.push(k), ...over,
  };
  const el = renderAttempt(props);
  document.body.append(el);
  return { el, calls, done, nav, snaps, clockNow, tick: () => tickFn && tickFn(), isStopped: () => stopped };
}
const btn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent === text);
const pick = (el, name, value) => { el.querySelector(`input[name="${name}"][value="${value}"]`).checked = true; };

test('renders every question with working controls and the page controls', () => {
  const { el } = mk();
  assert.equal(el.querySelectorAll('.question').length, 3);
  assert.equal(el.querySelectorAll('input[type=radio][name="q5:1_answer"]').length, 3);
  assert.ok(el.querySelector('input[type=text][name="q7:3_answer"]'));
  for (const t of ['Previous', 'Save', 'Next', 'Finish attempt']) assert.ok(btn(el, t), t);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/course/11/quiz/10');
  el.remove();
});

test('Previous is hidden on the first page and for sequential quizzes; Next is hidden on the last page', () => {
  const first = mk({ page: 0 });
  assert.equal(btn(first.el, 'Previous'), undefined);
  first.el.remove();
  const seq = mk({ sequential: true });
  assert.equal(btn(seq.el, 'Previous'), undefined);
  seq.el.remove();
  const last = mk({ nextPage: -1 });
  assert.equal(btn(last.el, 'Next'), undefined);
  assert.ok(btn(last.el, 'Finish attempt'));
  last.el.remove();
});

test('Next sends the page answers once and then navigates; Previous goes back', async () => {
  const { el, calls, nav } = mk();
  pick(el, 'q5:1_answer', 2);
  el.querySelector('input[name="q7:3_answer"]').value = 'casa';
  const next = btn(el, 'Next');
  next.click(); next.click();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'go');
  assert.equal(calls[0][2], 2);
  assert.ok(calls[0][1].some((a) => a.name === 'q5:1_answer' && a.value === '2'));
  assert.ok(calls[0][1].some((a) => a.name === 'q7:3_answer' && a.value === 'casa'));
  assert.ok(calls[0][1].some((a) => a.name === 'q5:1_:sequencecheck'));
  assert.deepEqual(nav, [2]);
  el.remove();
  const back = mk();
  btn(back.el, 'Previous').click();
  await tick();
  assert.equal(back.calls[0][2], 0);
  assert.deepEqual(back.nav, [0]);
  back.el.remove();
});

test('Save stays on the page and says Saved.', async () => {
  const { el, calls, nav } = mk();
  btn(el, 'Save').click();
  await tick();
  assert.equal(calls[0][0], 'save');
  assert.deepEqual(nav, []);
  assert.match(el.querySelector('.form-msg').textContent, /Saved\./);
  assert.equal(btn(el, 'Save').disabled, false);
  el.remove();
});

test('the question area is locked while a write is in flight and unlocked after an error', async () => {
  let fail; const gate = new Promise((_, rej) => { fail = rej; });
  const { el } = mk({ actions: { save: async () => { await gate; }, go: async () => {}, loadSummary: async () => ({ total: 1, answered: 1 }), finish: async () => {} } });
  btn(el, 'Save').click();
  assert.equal(el.querySelector('fieldset').disabled, true);
  fail(new MoodleError('attemptclosed', 'The attempt is closed'));
  await tick();
  assert.equal(el.querySelector('fieldset').disabled, false);
  assert.match(el.querySelector('.form-msg').textContent, /The attempt is closed/);
  el.remove();
});

test('error mapping: unconfirmed refreshes via onDone; signedout is silent', async () => {
  const a = mk({ actions: { save: async () => { throw new MoodleError('unconfirmed'); }, go: async () => {}, loadSummary: async () => ({}), finish: async () => {} } });
  btn(a.el, 'Save').click();
  await tick();
  assert.deepEqual(a.done, ['unknown']);
  a.el.remove();
  const b = mk({ actions: { save: async () => { throw new MoodleError('signedout'); }, go: async () => {}, loadSummary: async () => ({}), finish: async () => {} } });
  btn(b.el, 'Save').click();
  await tick();
  assert.equal(b.el.querySelector('.form-msg').textContent, '');
  assert.deepEqual(b.done, []);
  b.el.remove();
});

test('Finish shows a summary and needs a confirm; Cancel hides it; Confirm finishes once', async () => {
  const { el, calls, done } = mk();
  pick(el, 'q6:2_answer', 1);
  btn(el, 'Finish attempt').click();
  await tick();
  const confirm = el.querySelector('.confirm');
  assert.equal(confirm.hidden, false);
  assert.match(confirm.textContent, /answered 2 of 3 questions/);
  assert.equal(calls.length, 0);
  btn(el, 'Cancel').click();
  assert.equal(confirm.hidden, true);
  btn(el, 'Finish attempt').click();
  await tick();
  const yes = btn(el, 'Yes, submit');
  yes.click(); yes.click();
  await tick();
  assert.equal(calls.filter((c) => c[0] === 'finish').length, 1);
  const fin = calls.find((c) => c[0] === 'finish');
  assert.equal(fin[2].timeup, false);
  assert.ok(fin[1].some((a) => a.name === 'q6:2_answer' && a.value === '1'));
  assert.deepEqual(done, ['finished']);
  el.remove();
});

test('if the summary cannot be loaded Finish still asks for confirmation without counts', async () => {
  const { el } = mk({ actions: { save: async () => {}, go: async () => {}, loadSummary: async () => { throw new MoodleError('network'); }, finish: async () => {} } });
  btn(el, 'Finish attempt').click();
  await tick();
  assert.equal(el.querySelector('.confirm').hidden, false);
  assert.match(el.querySelector('.confirm').textContent, /cannot change your answers/);
  assert.ok(!/answered/.test(el.querySelector('.confirm').textContent));
  el.remove();
});

test('answers typed locally are reported for the local store and a given snapshot is restored', () => {
  const { el, snaps } = mk();
  const box = el.querySelector('input[name="q7:3_answer"]');
  box.value = 'hola';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(snaps.at(-1).t['q7:3_answer'], 'hola');
  el.remove();
  const snapshot = { t: { 'q7:3_answer': 'guardado' }, c: { 'q5:1_answer|1': true } };
  const r = mk({ snapshot });
  assert.equal(r.el.querySelector('input[name="q7:3_answer"]').value, 'guardado');
  assert.equal(r.el.querySelector('input[name="q5:1_answer"][value="1"]').checked, true);
  r.el.remove();
});

test('timer: counts down, locks the page at zero and turns Finish into Submit now with timeup=true; nothing is sent automatically', async () => {
  const t = mk({ endTime: 1100 });
  assert.match(t.el.querySelector('.timer').textContent, /Time left: 1:40/);
  t.clockNow.v = 1090;
  t.tick();
  assert.match(t.el.querySelector('.timer').textContent, /0:10/);
  assert.equal(t.el.querySelector('fieldset').disabled, false);
  t.clockNow.v = 1100;
  t.tick();
  assert.equal(t.el.querySelector('fieldset').disabled, true);
  assert.equal(t.el.querySelector('.time-up').hidden, false);
  for (const name of ['Previous', 'Save', 'Next']) assert.equal(btn(t.el, name).hidden, true, name);
  assert.equal(t.calls.length, 0);
  btn(t.el, 'Submit now').click();
  await tick();
  btn(t.el, 'Yes, submit').click();
  await tick();
  assert.equal(t.calls.find((c) => c[0] === 'finish')[2].timeup, true);
  t.el.remove();
});

test('the timer stops itself once the screen is gone', () => {
  const t = mk({ endTime: 1100 });
  t.tick();
  t.el.remove();
  t.tick();
  assert.equal(t.isStopped(), true);
});

test('an attempt with an unsupported question type shows only a note and a website link, no controls', () => {
  const { el } = mk({ questions: [...qs(), { slot: 4, number: 4, type: 'match', html: '<div class="que match"></div>' }] });
  assert.match(el.textContent, /cannot show/);
  assert.equal(el.querySelectorAll('input').length, 0);
  assert.equal(btn(el, 'Save'), undefined);
  assert.ok(el.querySelector('a[href*="mod/quiz/view.php"]'));
  el.remove();
});

test('review renders questions read-only with the grade and Moodle\'s message as text', () => {
  const el = renderReview({ courseId: 11, cmid: 10, quiz, grade: '7.50 out of 10.00', questions: [{ number: 1, html: mcqHtml(5, 1) }], message: 'Review <i>closed</i>', token: 'T' });
  assert.match(el.textContent, /7\.50 out of 10\.00/);
  assert.match(el.textContent, /Review <i>closed<\/i>/);
  assert.equal(el.querySelector('i'), null);
  assert.ok([...el.querySelectorAll('input:not([type=hidden])')].every((i) => i.hasAttribute('disabled')));
  assert.equal(el.querySelector('button'), null);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/course/11/quiz/10');
});
