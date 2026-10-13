import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { MoodleError } from '../src/api.js';

setupDom();
const { renderDiagnostics } = await import('../src/ui/diagnostics.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('shows running text, then the report, and enables Copy', async () => {
  const el = renderDiagnostics({ run: async () => 'REPORT TEXT', clipboard: { writeText: async () => {} } });
  assert.match(el.querySelector('pre.report').textContent, /Running checks/);
  assert.equal(el.querySelector('button.copy').disabled, true);
  await tick();
  assert.equal(el.querySelector('pre.report').textContent, 'REPORT TEXT');
  assert.equal(el.querySelector('button.copy').disabled, false);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/');
});

test('Copy writes the report to the clipboard and confirms', async () => {
  const copied = [];
  const el = renderDiagnostics({ run: async () => 'ABC', clipboard: { writeText: async (t) => { copied.push(t); } } });
  await tick();
  el.querySelector('button.copy').click();
  await tick();
  assert.deepEqual(copied, ['ABC']);
  assert.equal(el.querySelector('.copy-msg').textContent, 'Copied');
});

test('when the clipboard is missing or rejects, the text is selected and a hint shown', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) {
    const el = renderDiagnostics({ run: async () => 'ABC', clipboard });
    document.body.append(el);
    await tick();
    el.querySelector('button.copy').click();
    await tick();
    assert.equal(el.querySelector('.copy-msg').textContent, 'Select the text and copy it');
    assert.equal(window.getSelection().toString(), 'ABC');
    el.remove();
  }
});

test('a failing run shows a friendly error instead of the report', async () => {
  const el = renderDiagnostics({ run: async () => { throw new MoodleError('network'); }, clipboard: undefined });
  await tick();
  assert.match(el.querySelector('pre.report').textContent, /Cannot reach Aules/);
  assert.equal(el.querySelector('button.copy').disabled, true);
});

test('Test upload is never run automatically; tapping it appends the result to the report', async () => {
  let runs = 0;
  const el = renderDiagnostics({ run: async () => 'REPORT', clipboard: undefined, onUploadTest: async () => { runs += 1; return 'Upload test: ok'; } });
  await tick();
  assert.equal(runs, 0);
  const b = el.querySelector('button.upload-test');
  assert.equal(b.textContent, 'Test upload');
  b.click();
  assert.equal(b.disabled, true);
  await tick();
  assert.equal(runs, 1);
  assert.equal(el.querySelector('pre.report').textContent, 'REPORT\n\nUpload test: ok');
  assert.equal(b.disabled, false);
});

test('a throwing upload test is reported as a generic error line; the button is absent without a handler', async () => {
  const el = renderDiagnostics({ run: async () => 'R', clipboard: undefined, onUploadTest: async () => { throw new Error('x'); } });
  await tick();
  el.querySelector('button.upload-test').click();
  await tick();
  assert.match(el.querySelector('pre.report').textContent, /Upload test: error$/);
  const none = renderDiagnostics({ run: async () => 'R', clipboard: undefined });
  assert.equal(none.querySelector('button.upload-test'), null);
});
