import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { MoodleError } from '../src/api.js';
import { parseAssignment, parseStatus } from '../src/assign.js';

setupDom();
const { renderAssign } = await import('../src/ui/assign.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

const NOW = 1785000000;
const FURL = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/foto.jpg';
const cfg = (plugin, v) => ({ plugin, subtype: 'assignsubmission', name: 'enabled', value: v });
const rawA = (o = {}) => ({
  id: 42, cmid: 9, name: 'Tarea 1', intro: '<p>Haz esto</p><script>alert(1)</script>', duedate: NOW + 2 * 86400, cutoffdate: 0,
  submissiondrafts: 1, requiresubmissionstatement: 0, configs: [cfg('onlinetext', '1'), cfg('file', '1')],
  introattachments: [{ filename: 'guia.pdf', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/guia.pdf', filesize: 10 }], ...o,
});
const rawS = (o = {}) => ({
  lastattempt: { submission: { status: 'draft', plugins: [
    { type: 'onlinetext', editorfields: [{ text: '<p>mi respuesta</p>' }] },
    { type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: 'foto.jpg', fileurl: FURL, filesize: 100 }] }] },
  ] }, canedit: true, cansubmit: true }, ...o,
});

function mk(over = {}) {
  const sent = [];
  const done = [];
  const typed = [];
  const props = {
    courseId: 11, assignment: parseAssignment(rawA()), status: parseStatus(rawS()),
    editability: { editable: true, reason: '' }, uploadAvailable: true, maxBytes: 0, draftText: null, token: 'T',
    offline: false, now: NOW, locale: 'en', flash: '',
    actions: { send: async (i) => { sent.push(i); } }, onDone: (k) => done.push(k), onTextInput: (t) => typed.push(t), ...over,
  };
  const el = renderAssign(props);
  document.body.append(el);
  return { el, sent, done, typed, props };
}
const btn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent === text);
const setFiles = (input, files) => { Object.defineProperty(input, 'files', { value: files, configurable: true }); input.dispatchEvent(new window.Event('change')); };
const F = (name, size = 3) => { const f = new window.File(['abc'], name); Object.defineProperty(f, 'size', { value: size }); return f; };

test('renders title, status, due date, sanitized instructions and token-linked attachments', () => {
  const { el } = mk();
  assert.equal(el.querySelector('h2').textContent, 'Tarea 1');
  assert.equal(el.querySelector('.badge').textContent, 'Draft');
  assert.match(el.querySelector('.due').textContent, /in 2 days/);
  assert.equal(el.querySelector('script'), null);
  assert.match(el.querySelector('.intro').textContent, /Haz esto/);
  assert.match(el.querySelector('a[href*="guia.pdf"]').getAttribute('href'), /token=T/);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/course/11');
  el.remove();
});

test('form shows the existing answer; the file section depends on plugin and upload availability', () => {
  const a = mk();
  assert.equal(a.el.querySelector('textarea').value, 'mi respuesta');
  assert.ok(a.el.querySelector('input[type=file]'));
  a.el.remove();
  const b = mk({ uploadAvailable: false });
  assert.equal(b.el.querySelector('input[type=file]'), null);
  assert.match(b.el.textContent, /not available for your account/);
  b.el.remove();
  const c = mk({ assignment: parseAssignment(rawA({ configs: [cfg('onlinetext', '1')] })) });
  assert.equal(c.el.querySelector('input[type=file]'), null);
  assert.ok(!/not available for your account/.test(c.el.textContent));
  c.el.remove();
  const d = mk({ assignment: parseAssignment(rawA({ configs: [cfg('file', '1')] })) });
  assert.equal(d.el.querySelector('textarea'), null);
  d.el.remove();
});

test('Save draft sends once with the right input; unchanged text is not marked changed', async () => {
  const { el, sent, done } = mk();
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].submit, false);
  assert.equal(sent[0].textChanged, false);
  assert.equal(sent[0].files.changed, false);
  assert.deepEqual(done, ['saved']);
  el.remove();
});

test('editing the text marks it changed and passes the new text; typing is reported for local drafts', async () => {
  const { el, sent, typed } = mk();
  const ta = el.querySelector('textarea');
  ta.value = 'nueva respuesta';
  ta.dispatchEvent(new window.Event('input'));
  assert.deepEqual(typed, ['nueva respuesta']);
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent[0].textChanged, true);
  assert.equal(sent[0].text, 'nueva respuesta');
  el.remove();
});

test('a restored local draft is used as the starting text and counts as a change', async () => {
  const { el, sent } = mk({ draftText: 'borrador local' });
  assert.equal(el.querySelector('textarea').value, 'borrador local');
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent[0].textChanged, true);
  el.remove();
});

test('Submit never sends on the first tap; Cancel hides the confirm; Confirm sends submit:true', async () => {
  const { el, sent, done } = mk();
  const confirm = el.querySelector('.confirm');
  assert.equal(confirm.hidden, true);
  btn(el, 'Submit for grading').click();
  await tick();
  assert.equal(sent.length, 0);
  assert.equal(confirm.hidden, false);
  btn(el, 'Cancel').click();
  assert.equal(confirm.hidden, true);
  btn(el, 'Submit for grading').click();
  btn(el, 'Yes, submit').click();
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].submit, true);
  assert.deepEqual(done, ['submitted']);
  el.remove();
});

test('without drafts the only action is Submit, still behind the confirm', async () => {
  const { el, sent } = mk({ assignment: parseAssignment(rawA({ submissiondrafts: 0 })) });
  assert.equal(btn(el, 'Save draft'), undefined);
  btn(el, 'Submit').click();
  assert.equal(sent.length, 0);
  btn(el, 'Yes, submit').click();
  await tick();
  assert.equal(sent[0].submit, true);
  el.remove();
});

test('a required submission statement must be ticked before Confirm works and is passed on', async () => {
  const { el, sent } = mk({ assignment: parseAssignment(rawA({ requiresubmissionstatement: 1, submissionstatement: '<p>Es mi trabajo</p>' })) });
  btn(el, 'Submit for grading').click();
  const confirmBtn = btn(el, 'Yes, submit');
  const box = el.querySelector('input[type=checkbox]');
  assert.equal(confirmBtn.disabled, true);
  assert.match(el.querySelector('.confirm').textContent, /Es mi trabajo/);
  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  assert.equal(confirmBtn.disabled, false);
  confirmBtn.click();
  await tick();
  assert.equal(sent[0].acceptStatement, true);
  el.remove();
});

test('nothing to send: empty answer and no files shows a message and sends nothing', async () => {
  const { el, sent } = mk({ status: parseStatus({ lastattempt: { submission: { status: 'new', plugins: [] }, canedit: true } }) });
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent.length, 0);
  assert.match(el.querySelector('.form-msg').textContent, /Write an answer or add a file first/);
  btn(el, 'Submit for grading').click();
  assert.equal(el.querySelector('.confirm').hidden, true);
  el.remove();
});

test('rapid double taps send exactly once and the buttons are disabled while in flight', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const sent = [];
  const { el } = mk({ actions: { send: async (i) => { sent.push(i); await gate; } } });
  const save = btn(el, 'Save draft');
  save.click(); save.click(); save.click();
  assert.equal(sent.length, 1);
  assert.equal(save.disabled, true);
  release();
  await tick();
  el.remove();
});

test('a failing write shows a message, re-enables the buttons and does not report success', async () => {
  const { el, done } = mk({ actions: { send: async () => { throw new MoodleError('submissionclosed', 'The deadline passed'); } } });
  btn(el, 'Save draft').click();
  await tick();
  assert.match(el.querySelector('.form-msg').textContent, /The deadline passed/);
  assert.equal(btn(el, 'Save draft').disabled, false);
  assert.deepEqual(done, []);
  el.remove();
});

test('a network error during a write reports an unknown outcome instead of success', async () => {
  const { el, done } = mk({ actions: { send: async () => { throw new MoodleError('network'); } } });
  btn(el, 'Save draft').click();
  await tick();
  assert.deepEqual(done, ['unknown']);
  el.remove();
});

test('formatted existing text is locked until the student chooses to replace it', async () => {
  const status = parseStatus(rawS({ lastattempt: { submission: { status: 'draft', plugins: [{ type: 'onlinetext', editorfields: [{ text: '<p>hola <strong>mundo</strong></p>' }] }] }, canedit: true } }));
  const { el, sent } = mk({ status });
  const ta = el.querySelector('textarea');
  assert.equal(ta.disabled, true);
  assert.match(el.textContent, /formatting from the website/);
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent[0].textChanged, false); // locked text is never sent
  el.remove();
  // After a successful send the app re-renders the screen, so continue on a fresh one.
  const again = mk({ status });
  const ta2 = again.el.querySelector('textarea');
  btn(again.el, 'Replace with plain text').click();
  assert.equal(ta2.disabled, false);
  ta2.value = 'hola mundo';
  btn(again.el, 'Save draft').click();
  await tick();
  assert.equal(again.sent[0].textChanged, true);
  again.el.remove();
});

test('files: add, remove kept, size and count limits, and the send input reflects them', async () => {
  const { el, sent } = mk({ maxBytes: 1000, assignment: parseAssignment(rawA({ configs: [cfg('file', '1'), { plugin: 'file', subtype: 'assignsubmission', name: 'maxfilesubmissions', value: '2' }] })) });
  const input = el.querySelector('input[type=file]');
  setFiles(input, [F('big.bin', 5000)]);
  assert.match(el.querySelector('.form-msg').textContent, /too large/);
  setFiles(input, [F('a.pdf'), F('b.pdf')]); // kept foto.jpg + a.pdf = 2 -> b.pdf exceeds the limit
  assert.match(el.querySelector('.form-msg').textContent, /Too many files/);
  assert.ok([...el.querySelectorAll('.files li')].some((li) => li.textContent.includes('a.pdf')));
  assert.ok(![...el.querySelectorAll('.files li')].some((li) => li.textContent.includes('b.pdf')));
  [...el.querySelectorAll('.files li')].find((li) => li.textContent.includes('foto.jpg')).querySelector('button').click();
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent[0].files.changed, true);
  assert.deepEqual(sent[0].files.keep, []);
  assert.deepEqual(sent[0].files.added.map((f) => f.name), ['a.pdf']);
  el.remove();
});

test('read-only states hide the form, explain why, and still show the existing submission', () => {
  for (const [reason, text] of [['cutoff', /deadline has passed/], ['locked', /locked/], ['team', /Group submissions/], ['submitted', /Submitted\. Ask your teacher/]]) {
    const { el } = mk({ editability: { editable: false, reason } });
    assert.equal(el.querySelector('form'), null);
    assert.match(el.querySelector('.note').textContent, text);
    assert.match(el.querySelector('.submission').textContent, /mi respuesta/);
    assert.ok(el.querySelector('.readonly a[href*="foto.jpg"]'));
    el.remove();
  }
});

test('offline or missing status shows a read-only view with the offline note and never a form', () => {
  const a = mk({ offline: true });
  assert.equal(a.el.querySelector('form'), null);
  assert.match(a.el.textContent, /You are offline/);
  a.el.remove();
  const b = mk({ status: null, offline: true, editability: { editable: false, reason: 'notallowed' } });
  assert.equal(b.el.querySelector('form'), null);
  assert.equal(b.el.querySelector('.badge'), null);
  b.el.remove();
});

test('flash messages and graded feedback render safely', () => {
  const graded = parseStatus({ ...rawS(), feedback: { gradefordisplay: '8,00 / 10,00', plugins: [{ type: 'comments', editorfields: [{ text: '<p>Bien</p><img src=x onerror=alert(1)>' }] }] } });
  const { el } = mk({ status: graded, flash: 'saved' });
  assert.match(el.querySelector('.flash').textContent, /Draft saved/);
  assert.equal(el.querySelector('.badge').textContent, 'Graded');
  assert.match(el.querySelector('.grade').textContent, /8,00 \/ 10,00/);
  assert.match(el.querySelector('.feedback').textContent, /Bien/);
  assert.ok(!/onerror/.test(el.innerHTML));
  el.remove();
});
