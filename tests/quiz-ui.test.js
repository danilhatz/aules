import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { MoodleError } from '../src/api.js';
import { parseQuiz, parseAttempts, startCheck } from '../src/quiz.js';

setupDom();
const { renderQuiz } = await import('../src/ui/quiz.js');
const tick = () => new Promise((r) => setTimeout(r, 0));
const NOW = 1785000000;

const quiz = parseQuiz({ id: 3, coursemodule: 10, name: 'Test 1', intro: '<p>Hola</p><script>alert(1)</script>', timeclose: NOW + 2 * 86400, timelimit: 1800, attempts: 2, grade: 10, sumgrades: 4 });
const okInputs = () => ({
  quiz,
  access: { canattempt: true, activerulenames: ['quizaccess_timelimit'] },
  qtypes: { questiontypes: ['multichoice'] },
  attemptAccess: { preventnewattemptreasons: [], ispreflightcheckrequired: false },
  attempts: [],
});

function mk(over = {}) {
  const started = [];
  const done = [];
  const nav = [];
  const attempts = over.attempts || [];
  const props = {
    courseId: 11, cmid: 10, quiz, attempts, bestGrade: { has: false, grade: null },
    check: startCheck({ ...okInputs(), attempts }), fresh: true, offline: false, now: NOW, locale: 'en', flash: '', token: 'T',
    openUrl: 'https://aules.edu.gva.es/fpa/mod/quiz/view.php?id=10',
    actions: { start: async () => { started.push(1); return 77; } }, onStarted: (id) => nav.push(id), onDone: (k) => done.push(k), ...over,
  };
  const el = renderQuiz(props);
  document.body.append(el);
  return { el, started, done, nav };
}
const btn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent === text);

test('shows title, closing time, time limit, attempts allowed and sanitized instructions', () => {
  const { el } = mk();
  assert.equal(el.querySelector('h2').textContent, 'Test 1');
  assert.match(el.textContent, /Closes/);
  assert.match(el.textContent, /in 2 days/);
  assert.match(el.textContent, /30 min/);
  assert.match(el.textContent, /Attempts allowed/);
  assert.match(el.querySelector('.intro').textContent, /Hola/);
  assert.equal(el.querySelector('script'), null);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/course/11');
  el.remove();
});

test('Start needs a confirm: the first tap sends nothing, Cancel hides it, Yes starts once and navigates', async () => {
  const { el, started, nav } = mk();
  const confirm = el.querySelector('.confirm');
  assert.equal(confirm.hidden, true);
  btn(el, 'Start attempt').click();
  assert.equal(started.length, 0);
  assert.equal(confirm.hidden, false);
  assert.match(confirm.textContent, /uses one attempt/);
  assert.match(confirm.textContent, /30 minutes/);
  btn(el, 'Cancel').click();
  assert.equal(confirm.hidden, true);
  btn(el, 'Start attempt').click();
  const yes = btn(el, 'Yes, start');
  yes.click(); yes.click(); yes.click();
  await tick();
  assert.equal(started.length, 1);
  assert.deepEqual(nav, [77]);
  el.remove();
});

test('a failing start shows the message and re-enables; unconfirmed refreshes; signedout is silent', async () => {
  const a = mk({ actions: { start: async () => { throw new MoodleError('noattemptsleft', 'No attempts left'); } } });
  btn(a.el, 'Start attempt').click(); btn(a.el, 'Yes, start').click();
  await tick();
  assert.match(a.el.querySelector('.form-msg').textContent, /No attempts left/);
  assert.equal(btn(a.el, 'Yes, start').disabled, false);
  assert.deepEqual(a.nav, []);
  a.el.remove();
  const b = mk({ actions: { start: async () => { throw new MoodleError('unconfirmed'); } } });
  btn(b.el, 'Start attempt').click(); btn(b.el, 'Yes, start').click();
  await tick();
  assert.deepEqual(b.done, ['unknown']);
  b.el.remove();
  const c = mk({ actions: { start: async () => { throw new MoodleError('signedout'); } } });
  btn(c.el, 'Start attempt').click(); btn(c.el, 'Yes, start').click();
  await tick();
  assert.equal(c.el.querySelector('.form-msg').textContent, '');
  assert.deepEqual(c.done, []);
  c.el.remove();
});

test('Start is never offered from a saved copy, offline, or when the check is unknown', () => {
  for (const over of [{ fresh: false }, { offline: true }, { check: startCheck({ ...okInputs(), access: null }) }]) {
    const { el } = mk(over);
    assert.equal(btn(el, 'Start attempt'), undefined);
    assert.equal(el.querySelector('.confirm'), null);
    el.remove();
  }
  const saved = mk({ fresh: false });
  assert.match(saved.el.textContent, /Checking this quiz/);
  saved.el.remove();
});

test('unsupported quizzes explain why and offer Open in Aules instead of Start', () => {
  const attempts = [];
  const check = startCheck({ ...okInputs(), attempts, qtypes: { questiontypes: ['multichoice', 'match'] } });
  const { el } = mk({ check });
  assert.equal(btn(el, 'Start attempt'), undefined);
  assert.match(el.textContent, /needs the Aules website/);
  assert.match(el.textContent, /match/);
  const link = el.querySelector('a[href*="mod/quiz/view.php?id=10"]');
  assert.equal(link.textContent, 'Open in Aules');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  el.remove();
  const rules = mk({ check: startCheck({ ...okInputs(), access: { canattempt: true, activerulenames: ['quizaccess_password'] } }) });
  assert.match(rules.el.textContent, /quizaccess_password/);
  rules.el.remove();
  const pre = mk({ check: startCheck({ ...okInputs(), attemptAccess: { preventnewattemptreasons: [], ispreflightcheckrequired: true } }) });
  assert.match(pre.el.textContent, /extra confirmation/);
  pre.el.remove();
});

test('blocked shows Moodle\'s own reasons as text; overdue points to the website; continue links to the attempt', () => {
  const blocked = mk({ check: startCheck({ ...okInputs(), attemptAccess: { preventnewattemptreasons: ['No more attempts <b>allowed</b>'], ispreflightcheckrequired: false } }) });
  assert.match(blocked.el.textContent, /No more attempts <b>allowed<\/b>/); // plain text, not markup
  assert.equal(blocked.el.querySelector('b'), null);
  assert.equal(btn(blocked.el, 'Start attempt'), undefined);
  blocked.el.remove();
  const attempts = parseAttempts({ attempts: [{ id: 12, attempt: 1, state: 'overdue' }] });
  const over = mk({ attempts, check: startCheck({ ...okInputs(), attempts }) });
  assert.match(over.el.textContent, /overdue/);
  assert.ok(over.el.querySelector('a[href*="mod/quiz/view.php"]'));
  over.el.remove();
  const run = parseAttempts({ attempts: [{ id: 12, attempt: 1, state: 'inprogress' }] });
  const cont = mk({ attempts: run, check: startCheck({ ...okInputs(), attempts: run }) });
  assert.equal(cont.el.querySelector('a.btn').getAttribute('href'), '#/course/11/quiz/10/attempt/12');
  assert.equal(btn(cont.el, 'Start attempt'), undefined);
  cont.el.remove();
});

test('attempts list shows state and grade, with Review for finished attempts and none for an empty list', () => {
  const attempts = parseAttempts({ attempts: [
    { id: 11, attempt: 1, state: 'finished', sumgrades: 3, timestart: NOW - 99999, timefinish: NOW - 90000 },
    { id: 12, attempt: 2, state: 'abandoned' },
  ] });
  const { el } = mk({ attempts, bestGrade: { has: true, grade: 7.5 } });
  const rows = [...el.querySelectorAll('.attempts li')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Attempt 1/);
  assert.match(rows[0].textContent, /Finished/);
  assert.match(rows[0].textContent, /7\.5 \/ 10/);
  assert.equal(rows[0].querySelector('a').getAttribute('href'), '#/course/11/quiz/10/review/11');
  assert.equal(rows[1].querySelector('a'), null);
  assert.match(el.textContent, /Best grade/);
  el.remove();
  const none = mk();
  assert.match(none.el.textContent, /No attempts yet/);
  none.el.remove();
});

test('flash messages', () => {
  const { el } = mk({ flash: 'finished' });
  assert.match(el.querySelector('.flash').textContent, /Attempt finished/);
  el.remove();
  const u = mk({ flash: 'unknown' });
  assert.match(u.el.querySelector('.flash').textContent, /Could not confirm/);
  u.el.remove();
});
