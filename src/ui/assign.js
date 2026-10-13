import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';
import { withToken } from '../content.js';
import { sanitizeHtml } from '../sanitize.js';
import { formatDue, badgeState } from '../assign.js';

const html = (cls, raw, opts) => {
  const d = h('div', { class: cls });
  d.innerHTML = sanitizeHtml(raw, opts);
  return d;
};
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fileLinks = (files, token) => h('ul', { class: 'links' }, files.map((f) => h('li', {},
  h('a', { href: withToken(f.url, token), target: '_blank', rel: 'noopener noreferrer' }, f.name))));

function errorText(err) {
  const base = describeError(err);
  const detail = err && err.message && err.message !== err.code && !S.errors[err.code] ? ` ${err.message}` : '';
  return base + detail;
}

function buildForm(p, opts) {
  const a = p.assignment;
  const existing = p.status.text;
  // An automatically restored draft is only ever applied over plain (non-formatted) server text.
  const restored = p.draftText != null && existing.simple;
  let replaceFormatted = existing.simple;
  let kept = p.status.files.slice();
  let removedAny = false;
  const added = [];
  let busy = false;
  const buttons = [];

  const msg = h('p', { class: 'form-msg', role: 'alert' }, '');
  const say = (t) => { msg.textContent = t; };

  const textarea = a.plugins.onlinetext
    ? h('textarea', { name: 'answer', rows: 8, 'aria-label': S.yourAnswer, oninput: () => { if (p.onTextInput) p.onTextInput(textarea.value); } })
    : null;
  if (textarea) {
    textarea.value = restored ? p.draftText : existing.plain;
    if (!replaceFormatted) textarea.disabled = true;
  }
  const formattedNote = textarea && !replaceFormatted ? h('p', { class: 'note' }, S.formattedNote) : null;
  const enableReplace = () => {
    replaceFormatted = true;
    textarea.disabled = false;
    if (replaceBtn) replaceBtn.hidden = true;
    if (formattedNote) formattedNote.hidden = true;
  };
  const replaceBtn = textarea && !replaceFormatted
    ? h('button', { type: 'button', class: 'btn secondary', onclick: () => { enableReplace(); textarea.focus(); } }, S.replaceFormatted)
    : null;

  // A draft typed against different server text is offered, never applied silently.
  const stale = p.staleDraft;
  let staleBox = null;
  if (stale && textarea) {
    const when = new Intl.DateTimeFormat(p.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stale.savedAt));
    const restoreBtn = h('button', {
      type: 'button', class: 'btn secondary',
      onclick: () => {
        enableReplace(); // restoring over formatted text is an explicit choice to replace it
        textarea.value = stale.text;
        staleBox.hidden = true;
        if (p.onTextInput) p.onTextInput(stale.text);
      },
    }, S.restore);
    const discardBtn = h('button', {
      type: 'button', class: 'btn secondary',
      onclick: () => { staleBox.hidden = true; if (p.onDiscardDraft) p.onDiscardDraft(); },
    }, S.discard);
    staleBox = h('div', { class: 'stale-draft', role: 'group' }, h('p', {}, `${S.staleDraft} (${when}).`), restoreBtn, discardBtn);
  }

  const fileList = h('ul', { class: 'links files' });
  const renderFiles = () => {
    fileList.replaceChildren(
      ...kept.map((f) => h('li', {},
        h('a', { href: withToken(f.url, p.token), target: '_blank', rel: 'noopener noreferrer' }, f.name), ' ',
        h('button', { type: 'button', class: 'link remove', onclick: () => { kept = kept.filter((k) => k !== f); removedAny = true; renderFiles(); } }, S.remove))),
      ...added.map((f) => h('li', {}, `${f.name} (${fmtSize(f.size)}) `,
        h('button', { type: 'button', class: 'link remove', onclick: () => { added.splice(added.indexOf(f), 1); renderFiles(); } }, S.remove))),
    );
  };
  // iOS names every camera capture "image.jpg" and Moodle rejects duplicate names in one draft area.
  const uniqueName = (name) => {
    const taken = new Set([...kept.map((k) => k.name), ...added.map((f) => f.name)].map((n) => n.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i += 1) {
      const candidate = `${base} (${i})${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  };
  const uploadOk = a.plugins.file && p.uploadState === 'ok';
  const fileInput = uploadOk
    ? h('input', {
      type: 'file', multiple: true, 'aria-label': S.addFiles,
      onchange: () => {
        const FileCtor = (globalThis.window && globalThis.window.File) || globalThis.File;
        for (const f of Array.from(fileInput.files || [])) {
          if (p.maxBytes && f.size > p.maxBytes) { say(`${S.fileTooBig} (${f.name})`); continue; }
          if (a.maxFiles && kept.length + added.length >= a.maxFiles) { say(S.tooManyFiles); break; }
          const name = uniqueName(f.name);
          added.push(name === f.name ? f : new FileCtor([f], name, { type: f.type }));
        }
        fileInput.value = '';
        renderFiles();
      },
    })
    : null;
  if (uploadOk) renderFiles();

  const hasContent = () => (textarea && textarea.value.trim() !== '') || kept.length + added.length > 0;
  const filesChanged = () => removedAny || added.length > 0;
  const blockedByFormatting = () => Boolean(textarea) && !existing.simple && !replaceFormatted && filesChanged();
  const collect = (submit, acceptStatement) => ({
    submit,
    acceptStatement,
    text: textarea ? textarea.value : '',
    // Opting to replace formatted text counts as a change even if the plain text is identical.
    textChanged: Boolean(textarea) && replaceFormatted && (!existing.simple || textarea.value !== existing.plain),
    existing: { plain: existing.plain, simple: existing.simple },
    files: { changed: filesChanged(), keep: kept.map((f) => ({ name: f.name, url: f.url })), added: added.slice() },
  });
  const fields = h('fieldset', { class: 'answer-fields' });
  const setBusy = (b) => { busy = b; fields.disabled = b; for (const x of buttons) x.disabled = b; };
  const run = async (submit, acceptStatement) => {
    if (busy) return;
    setBusy(true);
    say('');
    try {
      await p.actions.send(collect(submit, acceptStatement));
      p.onDone(submit ? 'submitted' : 'saved');
    } catch (err) {
      if (err && err.code === 'signedout') return;
      if (err && err.code === 'unconfirmed') { p.onDone('unknown'); return; }
      say(errorText(err));
      setBusy(false);
      if (accept) confirmBtn.disabled = !accept.checked;
    }
  };

  const accept = a.statement.required ? h('input', { type: 'checkbox', id: 'accept' }) : null;
  const confirmBtn = h('button', { type: 'button', class: 'btn confirm-btn', disabled: Boolean(accept), onclick: () => run(true, accept ? accept.checked : false) }, S.confirmSubmit);
  if (accept) accept.addEventListener('change', () => { confirmBtn.disabled = busy || !accept.checked; });
  const cancelBtn = h('button', { type: 'button', class: 'btn secondary', onclick: () => { confirm.hidden = true; } }, S.cancel);
  const confirm = h('div', { class: 'confirm', hidden: true, role: 'group' },
    h('p', {}, a.drafts ? S.confirmSubmitText : S.confirmSendText),
    accept ? h('label', { class: 'check', for: 'accept' }, accept, ' ', html('html small', a.statement.html, opts)) : null,
    confirmBtn, cancelBtn);

  const canSubmitExistingDraft = a.drafts && p.status.status === 'draft';
  const submitBtn = h('button', {
    type: 'button', class: 'btn',
    onclick: () => {
      if (blockedByFormatting()) { say(S.formattedBlocksFiles); return; }
      if (!hasContent() && !canSubmitExistingDraft) { say(S.nothingToSend); return; }
      say('');
      confirm.hidden = false;
    },
  }, a.drafts ? S.submitForGrading : S.submit);
  const saveBtn = a.drafts
    ? h('button', {
      type: 'button', class: 'btn secondary',
      onclick: () => {
        if (blockedByFormatting()) { say(S.formattedBlocksFiles); return; }
        if (!hasContent()) { say(S.nothingToSend); return; }
        run(false, false);
      },
    }, S.saveDraft)
    : null;
  for (const b of [saveBtn, submitBtn, confirmBtn, cancelBtn, replaceBtn]) if (b) buttons.push(b);

  let fileSection = null;
  if (a.plugins.file) {
    fileSection = uploadOk
      ? h('div', { class: 'files-box' }, fileList, fileInput)
      : h('div', { class: 'files-box' },
        p.status.files.length ? fileLinks(p.status.files, p.token) : null,
        h('p', { class: 'note' }, p.uploadState === 'failed' ? S.uploadUnavailable : S.uploadUntested));
  }

  fields.append(
    ...[staleBox, textarea, formattedNote, replaceBtn, fileSection, msg,
      h('div', { class: 'actions' }, saveBtn, submitBtn), confirm].filter(Boolean),
  );
  return h('form', { class: 'answer-form', novalidate: true, onsubmit: (e) => e.preventDefault() }, fields);
}

function readOnly(p, opts) {
  const st = p.status;
  const reason = p.offline ? null : p.editability.reason;
  return h('div', { class: 'readonly' },
    h('p', { class: 'note' }, p.offline ? S.offlineNoEdit : (S.readonly[reason] || S.readonly.notallowed)),
    st && st.text.html ? html('html submission', st.text.html, opts) : null,
    st && st.files.length ? fileLinks(st.files, p.token) : null);
}

export function renderAssign(p) {
  const a = p.assignment;
  const opts = { rewriteUrl: (u) => withToken(u, p.token) };
  const due = formatDue(a.dueDate, p.now, p.locale);
  const st = p.status;
  const state = st ? badgeState(st) : null;
  const flashText = { saved: S.savedDraft, submitted: S.submittedOk, unknown: S.unconfirmed }[p.flash] || '';
  const canForm = p.editability.editable && st && !p.offline;
  return h('article', { class: 'course assign' },
    h('header', { class: 'bar' }, h('a', { class: 'back', href: `#/course/${p.courseId}` }, '‹ ', S.backToCourse), h('h2', {}, a.name)),
    ...(flashText ? [h('p', { class: `banner flash flash-${p.flash}`, role: 'status' }, flashText)] : []),
    ...(p.offline ? [h('p', { class: 'banner' }, S.offline)] : []),
    h('div', { class: 'assign-meta' },
      state ? h('span', { class: `badge badge-${state}` }, S.states[state]) : null,
      due.has ? h('span', { class: due.overdue ? 'due overdue' : 'due' }, `${due.relative} · ${due.absolute}`) : h('span', { class: 'due' }, S.noDueDate)),
    html('html intro', a.introHtml, opts),
    a.attachments.length ? fileLinks(a.attachments, p.token) : null,
    h('section', { class: 'answer' },
      h('h3', {}, canForm ? S.yourAnswer : S.yourSubmission),
      canForm ? buildForm(p, opts) : readOnly(p, opts)),
    st && (st.gradeText || st.feedbackHtml)
      ? h('section', { class: 'result' },
        st.gradeText ? h('p', { class: 'grade' }, `${S.gradeLabel}: ${st.gradeText}`) : null,
        st.feedbackHtml ? h('div', {}, h('h3', {}, S.feedbackLabel), html('html feedback', st.feedbackHtml, opts)) : null)
      : null);
}
