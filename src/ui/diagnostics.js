import { h } from './dom.js';
import { renderBack } from './course.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';

function selectAll(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function renderDiagnostics({ run, clipboard = globalThis.navigator && globalThis.navigator.clipboard, onUploadTest }) {
  const pre = h('pre', { class: 'report', tabindex: '0' }, S.running);
  const msg = h('p', { class: 'muted copy-msg' }, '');
  const btn = h('button', {
    class: 'btn copy', type: 'button', disabled: true,
    onclick: async () => {
      try {
        await clipboard.writeText(pre.textContent);
        msg.textContent = S.copied;
      } catch {
        selectAll(pre);
        msg.textContent = S.copyHint;
      }
    },
  }, S.copyReport);
  const uploadBtn = onUploadTest
    ? h('button', {
      class: 'btn secondary upload-test', type: 'button',
      onclick: async () => {
        uploadBtn.disabled = true;
        uploadBtn.textContent = S.testing;
        let line;
        try { line = await onUploadTest(); } catch { line = 'Upload test: error'; }
        pre.textContent = `${pre.textContent}\n\n${line}`;
        uploadBtn.disabled = false;
        uploadBtn.textContent = S.testUpload;
      },
    }, S.testUpload)
    : null;
  const el = h('article', { class: 'course diagnostics' },
    h('header', { class: 'bar' }, renderBack(), h('h2', {}, S.diagnostics)), pre, btn, ...(uploadBtn ? [uploadBtn] : []), msg);
  run().then(
    (text) => { pre.textContent = text; btn.disabled = false; },
    (err) => { pre.textContent = describeError(err); },
  );
  return el;
}
