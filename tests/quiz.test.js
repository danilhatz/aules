import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_QTYPES, parseQuiz, parseAttempts, parseBestGrade, attemptGrade, startCheck, formatTimeLeft } from '../src/quiz.js';

const rawQuiz = { id: 3, coursemodule: 10, name: 'Test 1', intro: '<p>Hola</p>', timeopen: 0, timeclose: 1790000000, timelimit: 1800, attempts: 2, grademethod: 1, grade: 10, sumgrades: 4, navmethod: 'free' };

test('parseQuiz normalises fields and tolerates missing ones', () => {
  const q = parseQuiz(rawQuiz);
  assert.deepEqual(q, { id: 3, cmid: 10, name: 'Test 1', introHtml: '<p>Hola</p>', timeOpen: 0, timeClose: 1790000000, timeLimit: 1800, attemptsAllowed: 2, gradeMethod: 1, maxGrade: 10, sumGrades: 4, sequential: false });
  assert.equal(parseQuiz({ id: 1, navmethod: 'sequential' }).sequential, true);
  const empty = parseQuiz(undefined);
  assert.equal(empty.name, ''); assert.equal(empty.timeLimit, 0); assert.equal(empty.attemptsAllowed, 0);
});

test('parseAttempts drops previews, sorts, and keeps unknown states safe', () => {
  const list = parseAttempts({ attempts: [
    { id: 12, attempt: 2, state: 'inprogress', timestart: 5, timefinish: 0, sumgrades: null, currentpage: 1 },
    { id: 11, attempt: 1, state: 'finished', timestart: 1, timefinish: 4, sumgrades: 3, currentpage: 0 },
    { id: 99, attempt: 3, state: 'finished', preview: 1 },
    { id: 13, attempt: 3, state: 'weird' },
    null,
  ] });
  assert.deepEqual(list.map((a) => [a.id, a.number, a.state]), [[11, 1, 'finished'], [12, 2, 'inprogress'], [13, 3, 'unknown']]);
  assert.equal(list[1].sumGrades, null);
  assert.equal(list[1].currentPage, 1);
  assert.deepEqual(parseAttempts(undefined), []);
  assert.deepEqual(parseAttempts({ attempts: 'x' }), []);
});

test('grades: attemptGrade scales finished attempts; best grade tolerates absence', () => {
  const quiz = parseQuiz(rawQuiz);
  assert.equal(attemptGrade({ state: 'finished', sumGrades: 3 }, quiz), 7.5);
  assert.equal(attemptGrade({ state: 'inprogress', sumGrades: 3 }, quiz), null);
  assert.equal(attemptGrade({ state: 'finished', sumGrades: null }, quiz), null);
  assert.equal(attemptGrade({ state: 'finished', sumGrades: 3 }, { ...quiz, sumGrades: 0 }), null);
  assert.deepEqual(parseBestGrade({ hasgrade: true, grade: 8.5 }), { has: true, grade: 8.5 });
  assert.deepEqual(parseBestGrade({ hasgrade: false }), { has: false, grade: null });
  assert.deepEqual(parseBestGrade(undefined), { has: false, grade: null });
});

const ok = () => ({
  quiz: parseQuiz(rawQuiz),
  access: { canattempt: true, activerulenames: ['quizaccess_openclosedate', 'quizaccess_numattempts', 'quizaccess_timelimit'], preventaccessreasons: [] },
  qtypes: { questiontypes: ['multichoice', 'truefalse', 'shortanswer', 'numerical', 'description'] },
  attemptAccess: { preventnewattemptreasons: [], ispreflightcheckrequired: false },
  attempts: [],
});

test('startCheck: a supported, open quiz can be started', () => {
  const r = startCheck(ok());
  assert.equal(r.mode, 'start'); assert.equal(r.canStart, true); assert.equal(r.attemptId, null);
});

test('startCheck: every missing input means unknown and never allows Start', () => {
  for (const key of ['access', 'qtypes', 'attemptAccess', 'attempts']) {
    const r = startCheck({ ...ok(), [key]: null });
    assert.equal(r.mode, 'unknown'); assert.equal(r.canStart, false);
  }
  assert.equal(startCheck({}).mode, 'unknown');
});

test('startCheck: unsupported rules, question types and pre-flight checks are refused and named', () => {
  const rules = startCheck({ ...ok(), access: { canattempt: true, activerulenames: ['quizaccess_password', 'quizaccess_timelimit', 'quizaccess_seb'] } });
  assert.equal(rules.mode, 'unsupported'); assert.equal(rules.canStart, false);
  assert.deepEqual(rules.unsupportedRules, ['quizaccess_password', 'quizaccess_seb']);
  const types = startCheck({ ...ok(), qtypes: { questiontypes: ['multichoice', 'match', 'essay'] } });
  assert.equal(types.mode, 'unsupported');
  assert.deepEqual(types.unsupportedTypes, ['match', 'essay']);
  const pre = startCheck({ ...ok(), attemptAccess: { preventnewattemptreasons: [], ispreflightcheckrequired: true } });
  assert.equal(pre.mode, 'unsupported'); assert.equal(pre.preflight, true);
});

test('startCheck priority: unsupported beats an in-progress attempt; overdue beats continue; continue beats blocked', () => {
  const inprog = [{ id: 12, number: 1, state: 'inprogress' }];
  assert.equal(startCheck({ ...ok(), attempts: inprog, qtypes: { questiontypes: ['essay'] } }).mode, 'unsupported');
  const over = startCheck({ ...ok(), attempts: [...inprog, { id: 13, number: 2, state: 'overdue' }] });
  assert.equal(over.mode, 'overdue'); assert.equal(over.canStart, false);
  const cont = startCheck({ ...ok(), attempts: inprog, attemptAccess: { preventnewattemptreasons: ['No attempts left'], ispreflightcheckrequired: false } });
  assert.equal(cont.mode, 'continue'); assert.equal(cont.attemptId, 12); assert.equal(cont.canStart, false);
});

test('startCheck: blocking reasons keep Moodle\'s own messages; canattempt false blocks', () => {
  const r = startCheck({ ...ok(), attemptAccess: { preventnewattemptreasons: ['No more attempts are allowed', 'You must wait'], ispreflightcheckrequired: false } });
  assert.equal(r.mode, 'blocked'); assert.equal(r.canStart, false);
  assert.deepEqual(r.messages, ['No more attempts are allowed', 'You must wait']);
  const c = startCheck({ ...ok(), access: { canattempt: false, activerulenames: [], preventaccessreasons: ['This quiz is closed'] } });
  assert.equal(c.mode, 'blocked'); assert.deepEqual(c.messages, ['This quiz is closed']);
  const noReason = startCheck({ ...ok(), access: { canattempt: false, activerulenames: [] } });
  assert.equal(noReason.mode, 'blocked'); assert.deepEqual(noReason.messages, []);
});

test('SUPPORTED_QTYPES is exactly the approved set', () => {
  assert.deepEqual([...SUPPORTED_QTYPES].sort(), ['description', 'multichoice', 'numerical', 'shortanswer', 'truefalse']);
});

test('formatTimeLeft', () => {
  assert.equal(formatTimeLeft(65), '1:05');
  assert.equal(formatTimeLeft(3725), '1:02:05');
  assert.equal(formatTimeLeft(9), '0:09');
  assert.equal(formatTimeLeft(0), '0:00');
  assert.equal(formatTimeLeft(-30), '0:00');
});
