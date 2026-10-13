# Assignments (Exercises) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the student open an Aules assignment from the course page, read it, write a typed answer, optionally attach files/photos, and save a draft or submit it, with strict write-safety, plus a user-run Test upload in Diagnostics.

**Architecture:** Pure, DOM-free logic modules (`assign.js` parsing/formatting, `submit.js` write orchestration, `drafts.js` local draft store) are unit-tested against mocked Moodle JSON; `ui/assign.js` renders the screen and talks to the app only through injected callbacks; `app.js` adds the route, loaders (reads through the existing silent-renewal `call()`, writes through a new no-replay `callWrite()`), epoch guards and wiring.

**Tech Stack:** Same as before (browser ES modules, Fetch, FormData, localStorage; dev: Node >= 20 `node:test`, `jsdom`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-assignments-design.md` (extends the two earlier specs in the same folder)

## Global Constraints

- Vanilla ES modules, **no build step**, no new dependencies. Strict CSP in `index.html` unchanged (no inline scripts/styles; `connect-src https://aules.edu.gva.es` already covers `webservice/upload.php`).
- Site base `https://aules.edu.gva.es/fpa`; token appended only to `.../fpa/webservice/pluginfile.php/...` URLs via `withToken`.
- **Write-safety (binding):** nothing is written without an explicit tap; **Save draft** and **Submit** are separate; **Submit** always goes through an in-page confirm step (and the submission-statement checkbox when required); single-flight (buttons disabled while a request is in flight); **no automatic retry or replay of any write**, no offline queue; an unknown outcome (network failure after a write was sent) shows "could not confirm", re-fetches the status and never assumes success/failure; plugin data is sent **only for plugins the student changed**; if retained files cannot be re-attached the whole save aborts; locked / past cut-off / not editable / team / `nosubmissions` -> no form.
- Moodle `warnings` returned by `mod_assign_save_submission` / `mod_assign_submit_for_grading` (non-empty array) are failures.
- All Moodle-supplied HTML (instructions, statement, feedback, existing submission text) renders only through `sanitizeHtml`; Moodle-supplied plain strings only via `textContent`/`h()`.
- Sign-out clears the token, saved login, caches, **local drafts (`aules.draft.*`)** and the `uploadOk` flag; in-flight results after sign-out are dropped (epoch guard).
- Tests use dummy values only (user number `10000001`); **no real credentials anywhere**; the assistant never enters the user's credentials into the live site and never runs the write calls against the live site.
- Touch targets >= 44px, body 17px, light/dark mode, phone one-pane / iPad two-pane layout preserved.
- `node --test` stays green after every task; each new `src/` module is added to `sw.js` SHELL in the task that creates it; nothing is pushed or published without the user's explicit approval.

## Review Focus

1. **Unchanged plugins are never sent:** text-only edit never includes `files_filemanager`; file-only edit never includes `onlinetext_editor`; no-op saves send nothing. (Task 4)
2. **Hostile answer text:** `<script>`, `&`, quotes, `<`/`>`, CRLF, blank-line runs, emoji and very long text are HTML-escaped correctly and round-trip through `htmlToPlain(textToHtml(x))`. (Task 2)
3. **Odd Moodle shapes:** missing `plugins`/`fileareas`/`editorfields`, `lastattempt` absent, status undefined, `canedit` missing, team submission, `nosubmissions`, cut-off passed but extension granted, `allowsubmissionsfromdate` in the future — never throws, never shows the form wrongly. (Tasks 2, 5)
4. **Double-tap and confirmation:** the first Submit tap never sends; rapid double taps send once; a network error during a write re-fetches instead of showing success. (Task 5)
5. **Sign-out / token expiry during a write:** result dropped after sign-out; an expired token during a write renews the session but **does not replay** the write (asks to tap again); drafts and the upload flag are cleared on sign-out. (Task 8)

---

## File Structure

```
src/api.js          + flatten, getAssignments, getSubmissionStatus, getUnusedDraftItemId, saveSubmission,
                      submitForGrading, deleteDraftFiles, uploadDraftFile; internal send() shared by post()/upload
src/assign.js       NEW parseAssignment, parseStatus, enabledPlugins, htmlToPlain, textToHtml, editability,
                      buildPlugindata, formatDue, badgeState
src/drafts.js       NEW createDrafts(storage)
src/submit.js       NEW performSubmission({api, write, assignment, input, fetchImpl})
src/ui/assign.js    NEW renderAssign(props)
src/ui/course.js    assign modules become links with due text
src/content.js      'assign' becomes kind 'assign' (no longer "coming soon")
src/ui/diagnostics.js  + Test upload button
src/app.js          route #/course/<c>/assign/<cmid>, loaders, callWrite, send, uploadTest, drafts, flash
src/main.js         pass drafts
src/strings.js, src/styles.css, sw.js (SHELL + VERSION v3)
tests/fixtures.js   + assign module, sampleAssignmentsResponse, sampleStatusResponse
tests/*.test.js     per task
tools/preview.js    fake assignment API for the demo
README.md
```

---

### Task 1: API additions (reads, writes, upload)

**Files:**
- Modify: `src/api.js`, `src/strings.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: existing `ws()`, `SITE_URL`, `MoodleError`.
- Produces:
  - `flatten(obj, prefix?) -> {[key]: scalar}` — `{a:{b:1,c:[2]}}` -> `{'a[b]':1,'a[c][0]':2}`.
  - `getAssignments(token, courseId, opts?)`, `getSubmissionStatus(token, assignId, opts?)`, `getUnusedDraftItemId(token, opts?) -> {itemid}`.
  - `saveSubmission(token, assignmentId, plugindata, opts?)`, `submitForGrading(token, assignmentId, acceptStatement: boolean, opts?)` — both throw `MoodleError(warningcode||'warning', message)` when the returned array is non-empty.
  - `deleteDraftFiles(token, itemId, files: {filepath, filename}[], opts?)`.
  - `uploadDraftFile(token, {name, blob}, {itemid = 0, fetchImpl}?) -> Promise<{itemid, filename}>` (multipart `FormData`, no JSON header).
  - `STRINGS.errors.retry`, `.keepfailed`, `.nochanges`.

- [ ] **Step 1: Write the failing tests**

Add to the import in `tests/api.test.js`: `flatten, getAssignments, getSubmissionStatus, getUnusedDraftItemId, saveSubmission, submitForGrading, deleteDraftFiles, uploadDraftFile`. Append:
```js
const bodyOf = (call) => new URLSearchParams(call.opts.body.toString());

test('flatten builds Moodle bracket keys, including arrays', () => {
  assert.deepEqual(flatten({ a: { b: 1, c: [2, 3] }, d: 'x' }), { 'a[b]': 1, 'a[c][0]': 2, 'a[c][1]': 3, d: 'x' });
  assert.deepEqual(flatten({ plugindata: { onlinetext_editor: { text: '<p>x</p>', format: 1, itemid: 5 }, files_filemanager: 9 } }),
    { 'plugindata[onlinetext_editor][text]': '<p>x</p>', 'plugindata[onlinetext_editor][format]': 1, 'plugindata[onlinetext_editor][itemid]': 5, 'plugindata[files_filemanager]': 9 });
});

test('read calls send the right function and params', async () => {
  const c1 = []; const c2 = []; const c3 = [];
  await getAssignments('t', 7, { fetchImpl: ok({ courses: [] }, c1) });
  await getSubmissionStatus('t', 42, { fetchImpl: ok({}, c2) });
  await getUnusedDraftItemId('t', { fetchImpl: ok({ itemid: 5 }, c3) });
  assert.equal(bodyOf(c1[0]).get('wsfunction'), 'mod_assign_get_assignments');
  assert.equal(bodyOf(c1[0]).get('courseids[0]'), '7');
  assert.equal(bodyOf(c2[0]).get('wsfunction'), 'mod_assign_get_submission_status');
  assert.equal(bodyOf(c2[0]).get('assignid'), '42');
  assert.equal(bodyOf(c3[0]).get('wsfunction'), 'core_files_get_unused_draft_itemid');
});

test('saveSubmission flattens plugindata and treats warnings as errors', async () => {
  const calls = [];
  await saveSubmission('t', 42, { onlinetext_editor: { text: '<p>hi &amp; bye</p>', format: 1, itemid: 5 }, files_filemanager: 9 }, { fetchImpl: ok([], calls) });
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'mod_assign_save_submission');
  assert.equal(b.get('assignmentid'), '42');
  assert.equal(b.get('plugindata[onlinetext_editor][text]'), '<p>hi &amp; bye</p>');
  assert.equal(b.get('plugindata[onlinetext_editor][format]'), '1');
  assert.equal(b.get('plugindata[onlinetext_editor][itemid]'), '5');
  assert.equal(b.get('plugindata[files_filemanager]'), '9');
  await assert.rejects(
    () => saveSubmission('t', 42, {}, { fetchImpl: ok([{ item: 'x', warningcode: 'submissionclosed', message: 'Closed' }]) }),
    (e) => e instanceof MoodleError && e.code === 'submissionclosed' && e.message === 'Closed',
  );
});

test('submitForGrading sends the statement flag and treats warnings as errors', async () => {
  const calls = [];
  await submitForGrading('t', 42, true, { fetchImpl: ok([], calls) });
  assert.equal(bodyOf(calls[0]).get('wsfunction'), 'mod_assign_submit_for_grading');
  assert.equal(bodyOf(calls[0]).get('acceptsubmissionstatement'), '1');
  const c2 = [];
  await submitForGrading('t', 42, false, { fetchImpl: ok([], c2) });
  assert.equal(bodyOf(c2[0]).get('acceptsubmissionstatement'), '0');
  await assert.rejects(() => submitForGrading('t', 42, true, { fetchImpl: ok([{ warningcode: 'nopermission', message: 'No' }]) }), (e) => e.code === 'nopermission');
  await assert.rejects(() => submitForGrading('t', 42, true, { fetchImpl: ok([{}]) }), (e) => e.code === 'warning');
});

test('deleteDraftFiles flattens the files list', async () => {
  const calls = [];
  await deleteDraftFiles('t', 77, [{ filepath: '/', filename: 'a.txt' }], { fetchImpl: ok([], calls) });
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'core_files_delete_draft_files');
  assert.equal(b.get('draftitemid'), '77');
  assert.equal(b.get('files[0][filepath]'), '/');
  assert.equal(b.get('files[0][filename]'), 'a.txt');
});

test('uploadDraftFile posts multipart form data to upload.php and returns the draft itemid', async () => {
  const calls = [];
  const r = await uploadDraftFile('tok', { name: 'photo.jpg', blob: new Blob(['abc'], { type: 'image/jpeg' }) }, { itemid: 12, fetchImpl: ok([{ itemid: 12, filename: 'photo.jpg' }], calls) });
  assert.deepEqual(r, { itemid: 12, filename: 'photo.jpg' });
  assert.equal(calls[0].url, 'https://aules.edu.gva.es/fpa/webservice/upload.php');
  const form = calls[0].opts.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('token'), 'tok');
  assert.equal(form.get('filearea'), 'draft');
  assert.equal(form.get('itemid'), '12');
  assert.equal(form.get('filepath'), '/');
  assert.equal(form.get('file_1').name, 'photo.jpg');
  assert.equal(calls[0].opts.headers, undefined); // the browser must set the multipart boundary itself
  assert.equal(calls[0].opts.credentials, 'omit');
});

test('uploadDraftFile maps error JSON, empty results and network failures', async () => {
  const file = { name: 'a.txt', blob: new Blob(['x']) };
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: ok({ error: 'no', errorcode: 'nopermissions' }) }), (e) => e.code === 'nopermissions');
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: ok([]) }), (e) => e.code === 'badresponse');
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: async () => { throw new TypeError('x'); } }), (e) => e.code === 'network');
});
```

- [ ] **Step 2: Run, expect FAIL** (`does not provide an export named 'flatten'`).

- [ ] **Step 3: Implement**

In `src/api.js`, replace the existing `post` function with `send` + `post`:
```js
async function send(url, body, fetchImpl) {
  const f = fetchImpl || globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await f(url, {
      method: 'POST',
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new MoodleError('network');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new MoodleError('badresponse');
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && (data.error || data.exception || data.errorcode)) {
    throw new MoodleError(data.errorcode || data.exception || 'unknown', data.error || data.message);
  }
  return data;
}

const post = (url, params, fetchImpl) => send(url, new URLSearchParams(params), fetchImpl);
```
Append to `src/api.js`:
```js
export function flatten(value, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

export const getAssignments = (token, courseId, { fetchImpl } = {}) =>
  ws(token, 'mod_assign_get_assignments', { 'courseids[0]': courseId }, fetchImpl);

export const getSubmissionStatus = (token, assignId, { fetchImpl } = {}) =>
  ws(token, 'mod_assign_get_submission_status', { assignid: assignId }, fetchImpl);

export const getUnusedDraftItemId = (token, { fetchImpl } = {}) =>
  ws(token, 'core_files_get_unused_draft_itemid', {}, fetchImpl);

function throwOnWarnings(result) {
  if (Array.isArray(result) && result.length) {
    const w = result[0] || {};
    throw new MoodleError(w.warningcode || 'warning', w.message || w.warningcode || 'warning');
  }
  return result;
}

export const saveSubmission = async (token, assignmentId, plugindata, { fetchImpl } = {}) =>
  throwOnWarnings(await ws(token, 'mod_assign_save_submission', { assignmentid: assignmentId, ...flatten({ plugindata }) }, fetchImpl));

export const submitForGrading = async (token, assignmentId, acceptStatement, { fetchImpl } = {}) =>
  throwOnWarnings(await ws(token, 'mod_assign_submit_for_grading', { assignmentid: assignmentId, acceptsubmissionstatement: acceptStatement ? 1 : 0 }, fetchImpl));

export const deleteDraftFiles = (token, itemId, files, { fetchImpl } = {}) =>
  ws(token, 'core_files_delete_draft_files', { draftitemid: itemId, ...flatten({ files }) }, fetchImpl);

export async function uploadDraftFile(token, file, { itemid = 0, fetchImpl } = {}) {
  const form = new FormData();
  form.append('token', token);
  form.append('filearea', 'draft');
  form.append('itemid', String(itemid));
  form.append('filepath', '/');
  form.append('file_1', file.blob, file.name);
  const data = await send(`${SITE_URL}/webservice/upload.php`, form, fetchImpl);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || first.itemid == null) throw new MoodleError('badresponse');
  return { itemid: first.itemid, filename: first.filename };
}
```
In `src/strings.js` add to `errors`:
```js
    retry: 'Your session was renewed. Please tap again.',
    keepfailed: 'Could not re-attach one of your existing files. Nothing was saved.',
    nochanges: 'Nothing to send yet.',
```

- [ ] **Step 4: Run `npm test`, expect PASS** (existing API tests still pass: `send` keeps the old behaviour). Commit:
```bash
git add -A && git commit -m "feat: assignment read/write and upload API calls"
```

---

### Task 2: Pure assignment logic

**Files:**
- Create: `src/assign.js`, `tests/assign.test.js`
- Modify: `sw.js` (add `"./src/assign.js"`)

**Interfaces:**
- Produces (all pure, no DOM):
  - `enabledPlugins(configs) -> {onlinetext:boolean, file:boolean}`
  - `htmlToPlain(html) -> {plain:string, simple:boolean}` (`simple` = only `p`/`br` tags)
  - `textToHtml(text) -> string` (escaped, `<p>` per blank-line-separated paragraph, `<br>` for single newlines, `''` for blank)
  - `parseAssignment(raw) -> {id, cmid, name, introHtml, attachments:{name,url,size}[], dueDate, allowFrom, cutoff, noSubmissions, drafts, team, statement:{required,html}, plugins:{onlinetext,file}, maxFiles, maxBytes}` (times in Moodle seconds, `0` = none)
  - `parseStatus(raw) -> {status:'new'|'draft'|'submitted'|'reopened', canEdit, canSubmit, locked, graded, extensionDue, text:{html,plain,simple}, files:{name,url,size}[], gradeText, feedbackHtml}`
  - `editability(assignment, status, nowSeconds) -> {editable:boolean, reason:''|'team'|'nosubmissions'|'noplugins'|'notopen'|'locked'|'cutoff'|'submitted'|'notallowed'}`
  - `buildPlugindata({text, textChanged, textItemId, filesChanged, filesItemId}) -> object` (only changed plugins)
  - `formatDue(ts, nowSeconds, locale) -> {has, absolute, relative, overdue}`
  - `badgeState(status) -> 'notsubmitted'|'draft'|'submitted'|'graded'`

- [ ] **Step 1: Write the failing tests** `tests/assign.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabledPlugins, htmlToPlain, textToHtml, parseAssignment, parseStatus, editability, buildPlugindata, formatDue, badgeState,
} from '../src/assign.js';

const cfgs = [
  { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '1' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '0' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'maxfilesubmissions', value: '3' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'maxsubmissionsizebytes', value: '1048576' },
  { plugin: 'comments', subtype: 'assignfeedback', name: 'enabled', value: '1' },
];

test('enabledPlugins reads only assignsubmission enabled flags and tolerates junk', () => {
  assert.deepEqual(enabledPlugins(cfgs), { onlinetext: true, file: false });
  assert.deepEqual(enabledPlugins(undefined), { onlinetext: false, file: false });
  assert.deepEqual(enabledPlugins([null, 5, { plugin: 'file' }]), { onlinetext: false, file: false });
});

test('textToHtml escapes hostile text and keeps paragraphs and line breaks', () => {
  assert.equal(textToHtml(''), '');
  assert.equal(textToHtml('  \n '), '');
  assert.equal(textToHtml('a'), '<p>a</p>');
  assert.equal(textToHtml('a\nb\n\n\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(textToHtml('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(textToHtml(`<script>alert("x")</script> & 'q'`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
});

test('htmlToPlain round-trips text produced by textToHtml (incl. emoji and entities)', () => {
  for (const t of ['hola', 'a\nb', 'a\n\nb', '5 < 6 & 7 > 3', `"quoted" 'single'`, 'ñandú 🙂', 'x'.repeat(5000)]) {
    const r = htmlToPlain(textToHtml(t));
    assert.equal(r.plain, t);
    assert.equal(r.simple, true);
  }
});

test('htmlToPlain flags formatting and decodes entities after stripping tags', () => {
  assert.deepEqual(htmlToPlain(''), { plain: '', simple: true });
  assert.equal(htmlToPlain('<p dir="ltr" style="text-align: left;">hi</p>').simple, true);
  assert.equal(htmlToPlain('<p>hi <strong>there</strong></p>').simple, false);
  assert.equal(htmlToPlain('<ul><li>a</li></ul>').simple, false);
  assert.equal(htmlToPlain('<img src=x>').simple, false);
  assert.equal(htmlToPlain('<p>&lt;b&gt;not bold&lt;/b&gt;</p>').plain, '<b>not bold</b>');
  assert.equal(htmlToPlain('<p>one</p>\n<p>two</p>').plain, 'one\n\ntwo');
});

const rawAssign = {
  id: 42, cmid: 9, name: 'Tarea 1', intro: '<p>Haz esto</p>', duedate: 1790000000, allowsubmissionsfromdate: 1780000000, cutoffdate: 0,
  nosubmissions: 0, submissiondrafts: 1, teamsubmission: 0, requiresubmissionstatement: 1, submissionstatement: '<p>Es mi trabajo</p>',
  introattachments: [{ filename: 'guia.pdf', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/guia.pdf', filesize: 2048 }, { filename: 'bad' }],
  configs: cfgs,
};

test('parseAssignment normalises fields and tolerates missing ones', () => {
  const a = parseAssignment(rawAssign);
  assert.equal(a.id, 42); assert.equal(a.cmid, 9); assert.equal(a.name, 'Tarea 1');
  assert.equal(a.dueDate, 1790000000); assert.equal(a.cutoff, 0);
  assert.equal(a.drafts, true); assert.equal(a.team, false); assert.equal(a.noSubmissions, false);
  assert.deepEqual(a.statement, { required: true, html: '<p>Es mi trabajo</p>' });
  assert.deepEqual(a.plugins, { onlinetext: true, file: false });
  assert.equal(a.maxFiles, 3); assert.equal(a.maxBytes, 1048576);
  assert.deepEqual(a.attachments, [{ name: 'guia.pdf', url: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/guia.pdf', size: 2048 }]);
  const empty = parseAssignment({ id: 1, cmid: 2 });
  assert.deepEqual(empty.plugins, { onlinetext: false, file: false });
  assert.equal(empty.name, ''); assert.equal(empty.dueDate, 0); assert.deepEqual(empty.attachments, []);
});

const rawStatus = {
  lastattempt: {
    submission: { status: 'draft', plugins: [
      { type: 'onlinetext', editorfields: [{ name: 'onlinetext', text: '<p>mi respuesta</p>', format: 1 }] },
      { type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: 'foto.jpg', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/foto.jpg', filesize: 100 }] }] },
    ] },
    canedit: true, cansubmit: true, locked: false, graded: false, extensionduedate: 0,
  },
  feedback: { gradefordisplay: '<b>8,00</b> / 10,00', plugins: [{ type: 'comments', editorfields: [{ name: 'comments', text: '<p>Bien</p>' }] }] },
};

test('parseStatus extracts text, files, grade and feedback', () => {
  const s = parseStatus(rawStatus);
  assert.equal(s.status, 'draft'); assert.equal(s.canEdit, true); assert.equal(s.canSubmit, true);
  assert.deepEqual(s.text, { html: '<p>mi respuesta</p>', plain: 'mi respuesta', simple: true });
  assert.deepEqual(s.files.map((f) => f.name), ['foto.jpg']);
  assert.equal(s.gradeText, '8,00 / 10,00');
  assert.equal(s.feedbackHtml, '<p>Bien</p>');
});

test('parseStatus never throws on missing pieces and defaults to a safe state', () => {
  for (const raw of [undefined, null, {}, { lastattempt: {} }, { lastattempt: { submission: { status: 'weird', plugins: [null, {}, { type: 'file' }, { type: 'onlinetext' }] } } }]) {
    const s = parseStatus(raw);
    assert.equal(s.status, 'new');
    assert.equal(s.canEdit, false);
    assert.deepEqual(s.files, []);
    assert.equal(s.text.plain, '');
    assert.equal(s.gradeText, '');
  }
  assert.equal(parseStatus({ feedback: { gradefordisplay: '-' } }).gradeText, '');
});

test('badgeState', () => {
  assert.equal(badgeState(parseStatus(rawStatus)), 'graded');
  assert.equal(badgeState({ status: 'new', graded: false, gradeText: '' }), 'notsubmitted');
  assert.equal(badgeState({ status: 'reopened', graded: false, gradeText: '' }), 'notsubmitted');
  assert.equal(badgeState({ status: 'draft', graded: false, gradeText: '' }), 'draft');
  assert.equal(badgeState({ status: 'submitted', graded: false, gradeText: '' }), 'submitted');
});

const NOW = 1785000000;
const A = (o = {}) => ({ ...parseAssignment(rawAssign), plugins: { onlinetext: true, file: true }, allowFrom: 0, ...o });
const S = (o = {}) => ({ ...parseStatus(rawStatus), ...o });

test('editability covers every closed/locked/odd state without throwing', () => {
  assert.deepEqual(editability(A(), S(), NOW), { editable: true, reason: '' });
  assert.equal(editability(A({ team: true }), S(), NOW).reason, 'team');
  assert.equal(editability(A({ noSubmissions: true }), S(), NOW).reason, 'nosubmissions');
  assert.equal(editability(A({ plugins: { onlinetext: false, file: false } }), S(), NOW).reason, 'noplugins');
  assert.equal(editability(A({ allowFrom: NOW + 100 }), S(), NOW).reason, 'notopen');
  assert.equal(editability(A(), S({ locked: true }), NOW).reason, 'locked');
  assert.equal(editability(A({ cutoff: NOW - 10 }), S(), NOW).reason, 'cutoff');
  assert.equal(editability(A({ cutoff: NOW - 10 }), S({ extensionDue: NOW + 1000 }), NOW).editable, true); // extension beats cut-off
  assert.equal(editability(A({ cutoff: 0 }), S(), NOW).editable, true); // no cut-off
  assert.equal(editability(A(), S({ canEdit: false, status: 'submitted' }), NOW).reason, 'submitted');
  assert.equal(editability(A(), S({ canEdit: false, status: 'draft' }), NOW).reason, 'notallowed');
});

test('buildPlugindata includes only the changed plugins', () => {
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: true, textItemId: 5, filesChanged: false, filesItemId: 9 }),
    { onlinetext_editor: { text: '<p>hi</p>', format: 1, itemid: 5 } });
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: false, textItemId: 5, filesChanged: true, filesItemId: 9 }), { files_filemanager: 9 });
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: true, textItemId: 5, filesChanged: true, filesItemId: 9 }),
    { onlinetext_editor: { text: '<p>hi</p>', format: 1, itemid: 5 }, files_filemanager: 9 });
  assert.deepEqual(buildPlugindata({ textChanged: false, filesChanged: false }), {});
});

test('formatDue gives relative and absolute text and flags overdue', () => {
  assert.deepEqual(formatDue(0, NOW, 'en'), { has: false, absolute: '', relative: '', overdue: false });
  const future = formatDue(NOW + 2 * 86400, NOW, 'en');
  assert.equal(future.has, true); assert.equal(future.relative, 'in 2 days'); assert.equal(future.overdue, false);
  assert.match(future.absolute, /\d{4}/);
  const past = formatDue(NOW - 3 * 3600, NOW, 'en');
  assert.equal(past.relative, '3 hours ago'); assert.equal(past.overdue, true);
  assert.equal(formatDue(NOW + 5 * 60, NOW, 'en').relative, 'in 5 minutes');
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../src/assign.js'`).

- [ ] **Step 3: Implement** `src/assign.js`; add `"./src/assign.js",` to `sw.js` SHELL (after `"./src/api.js",`)

```js
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);

export function enabledPlugins(configs) {
  const on = (plugin) => list(configs).some((c) => c && c.plugin === plugin && c.subtype === 'assignsubmission' && c.name === 'enabled' && String(c.value) === '1');
  return { onlinetext: on('onlinetext'), file: on('file') };
}

const cfg = (configs, plugin, name) => {
  const c = list(configs).find((x) => x && x.plugin === plugin && x.name === name);
  return c ? num(c.value) : 0;
};

const fileList = (files) => list(files)
  .filter((f) => f && f.fileurl)
  .map((f) => ({ name: String(f.filename || ''), url: f.fileurl, size: num(f.filesize) }));

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
const stripTags = (html) => decode(html.replace(/<[^>]*>/g, '')).trim();

export function htmlToPlain(html) {
  const src = String(html || '');
  if (!src.trim()) return { plain: '', simple: true };
  const tags = [...src.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)].map((m) => m[1].toLowerCase());
  const simple = tags.every((t) => t === 'p' || t === 'br');
  let t = src.replace(/\r?\n/g, ' '); // source newlines are not significant in HTML
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<\/?p[^>]*>/gi, '');
  t = t.replace(/<[^>]*>/g, '');
  return { plain: decode(t).trim(), simple };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function textToHtml(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

export function parseAssignment(raw) {
  const r = raw || {};
  return {
    id: r.id,
    cmid: r.cmid,
    name: r.name || '',
    introHtml: r.intro || '',
    attachments: fileList(r.introattachments),
    dueDate: num(r.duedate),
    allowFrom: num(r.allowsubmissionsfromdate),
    cutoff: num(r.cutoffdate),
    noSubmissions: Boolean(num(r.nosubmissions)),
    drafts: Boolean(num(r.submissiondrafts)),
    team: Boolean(num(r.teamsubmission)),
    statement: { required: Boolean(num(r.requiresubmissionstatement)), html: r.submissionstatement || '' },
    plugins: enabledPlugins(r.configs),
    maxFiles: cfg(r.configs, 'file', 'maxfilesubmissions'),
    maxBytes: cfg(r.configs, 'file', 'maxsubmissionsizebytes'),
  };
}

export function parseStatus(raw) {
  const last = (raw && raw.lastattempt) || {};
  const sub = last.submission || {};
  const plugins = list(sub.plugins);
  const textPlugin = plugins.find((p) => p && p.type === 'onlinetext');
  const field = textPlugin ? list(textPlugin.editorfields)[0] : null;
  const filePlugin = plugins.find((p) => p && p.type === 'file');
  const areas = filePlugin ? list(filePlugin.fileareas) : [];
  const area = areas.find((a) => a && a.area === 'submission_files') || areas[0] || null;
  const fb = (raw && raw.feedback) || {};
  const comments = list(fb.plugins).find((p) => p && p.type === 'comments');
  const cField = comments ? list(comments.editorfields)[0] : null;
  const html = field && field.text ? String(field.text) : '';
  const plain = htmlToPlain(html);
  const grade = fb.gradefordisplay ? stripTags(String(fb.gradefordisplay)) : '';
  return {
    status: ['new', 'draft', 'submitted', 'reopened'].includes(sub.status) ? sub.status : 'new',
    canEdit: last.canedit === true,
    canSubmit: last.cansubmit === true,
    locked: last.locked === true,
    graded: last.graded === true,
    extensionDue: num(last.extensionduedate),
    text: { html, plain: plain.plain, simple: plain.simple },
    files: fileList(area && area.files),
    gradeText: /^[-–—]?$/.test(grade) ? '' : grade,
    feedbackHtml: cField && cField.text ? String(cField.text) : '',
  };
}

export function badgeState(status) {
  if (status.graded || status.gradeText) return 'graded';
  if (status.status === 'submitted') return 'submitted';
  if (status.status === 'draft') return 'draft';
  return 'notsubmitted';
}

export function editability(assignment, status, now) {
  if (assignment.team) return { editable: false, reason: 'team' };
  if (assignment.noSubmissions) return { editable: false, reason: 'nosubmissions' };
  if (!assignment.plugins.onlinetext && !assignment.plugins.file) return { editable: false, reason: 'noplugins' };
  if (assignment.allowFrom && now < assignment.allowFrom) return { editable: false, reason: 'notopen' };
  if (status.locked) return { editable: false, reason: 'locked' };
  if (assignment.cutoff && now > Math.max(assignment.cutoff, status.extensionDue)) return { editable: false, reason: 'cutoff' };
  if (!status.canEdit) return { editable: false, reason: status.status === 'submitted' ? 'submitted' : 'notallowed' };
  return { editable: true, reason: '' };
}

export function buildPlugindata({ text, textChanged, textItemId, filesChanged, filesItemId }) {
  const data = {};
  if (textChanged) data.onlinetext_editor = { text: textToHtml(text), format: 1, itemid: textItemId };
  if (filesChanged) data.files_filemanager = filesItemId;
  return data;
}

export function formatDue(ts, now, locale) {
  if (!ts) return { has: false, absolute: '', relative: '', overdue: false };
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let relative;
  if (abs < 3600) relative = rtf.format(Math.round(diff / 60), 'minute');
  else if (abs < 86400) relative = rtf.format(Math.round(diff / 3600), 'hour');
  else relative = rtf.format(Math.round(diff / 86400), 'day');
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts * 1000));
  return { has: true, absolute, relative, overdue: diff < 0 };
}
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: pure assignment parsing, text conversion and editability logic"
```

---

### Task 3: Local draft store

**Files:**
- Create: `src/drafts.js`, `tests/drafts.test.js`
- Modify: `sw.js` (add `"./src/drafts.js"`)

**Interfaces:**
- Produces: `createDrafts(storage) -> {get(id): {text, savedAt}|null, set(id, text): void, remove(id): void, clear(): void}`; keys `aules.draft.<id>`; an index key makes `clear()` remove every draft; best-effort, never throws; index is written before the data (no orphans).

- [ ] **Step 1: Write the failing tests** `tests/drafts.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createDrafts } from '../src/drafts.js';

test('set/get/remove round-trip per assignment id', () => {
  const d = createDrafts(createMemoryStorage());
  assert.equal(d.get(7), null);
  d.set(7, 'hola\n\nmundo');
  d.set(8, 'otro');
  assert.equal(d.get(7).text, 'hola\n\nmundo');
  assert.equal(typeof d.get(7).savedAt, 'number');
  d.remove(7);
  assert.equal(d.get(7), null);
  assert.equal(d.get(8).text, 'otro');
});

test('clear removes every draft but nothing else', () => {
  const s = createMemoryStorage();
  s.setItem('aules.session', 'keep');
  const d = createDrafts(s);
  d.set(1, 'a'); d.set(2, 'b');
  d.clear();
  assert.equal(d.get(1), null); assert.equal(d.get(2), null);
  assert.equal(s.getItem('aules.session'), 'keep');
  assert.equal(s.getItem('aules.draft.1'), null);
});

test('corrupt entries are a miss; storage failures never throw; a failed data write leaves nothing clear() cannot remove', () => {
  const s = createMemoryStorage();
  s.setItem('aules.draft.5', '{oops');
  assert.equal(createDrafts(s).get(5), null);
  const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  const b = createDrafts(boom);
  assert.doesNotThrow(() => { b.set(1, 'x'); b.remove(1); b.clear(); });
  assert.equal(b.get(1), null);

  const s2 = createMemoryStorage();
  let writes = 0;
  const flaky = { ...s2, setItem: (k, v) => { writes += 1; if (writes === 2) throw new DOMException('full', 'QuotaExceededError'); s2.setItem(k, v); } };
  createDrafts(flaky).set(3, 'big');
  createDrafts(s2).clear();
  assert.equal(s2.getItem('aules.draft.3'), null);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `src/drafts.js`

```js
const P = 'aules.draft.';
const INDEX = 'aules.drafts.__index';

export function createDrafts(storage) {
  const readIndex = () => {
    try { return JSON.parse(storage.getItem(INDEX)) || []; } catch { return []; }
  };
  return {
    get(id) {
      try {
        const v = JSON.parse(storage.getItem(P + id));
        return v && typeof v.text === 'string' ? v : null;
      } catch { return null; }
    },
    set(id, text) {
      try {
        const key = String(id);
        const idx = readIndex();
        if (!idx.includes(key)) storage.setItem(INDEX, JSON.stringify([...idx, key])); // index first: no orphans
        storage.setItem(P + key, JSON.stringify({ text, savedAt: Date.now() }));
      } catch { /* best effort */ }
    },
    remove(id) {
      try { storage.removeItem(P + id); } catch { /* best effort */ }
    },
    clear() {
      try {
        for (const id of readIndex()) storage.removeItem(P + id);
        storage.removeItem(INDEX);
      } catch { /* best effort */ }
    },
  };
}
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: local draft store for typed answers"
```

---

### Task 4: Write orchestration (`performSubmission`)

**Files:**
- Create: `src/submit.js`, `tests/submit.test.js`
- Modify: `sw.js` (add `"./src/submit.js"`)

**Interfaces:**
- Consumes: `api.getUnusedDraftItemId`, `api.uploadDraftFile`, `api.saveSubmission`, `api.submitForGrading`, `buildPlugindata`, `withToken`, `MoodleError`.
- Produces: `performSubmission({api, write, assignment, input, fetchImpl?}) -> Promise<{saved:boolean, submitted:boolean}>` where
  - `write(fn)` runs `fn(session)` once with no replay (app's `callWrite`), `session = {token, userid}`;
  - `assignment` is a `parseAssignment` result;
  - `input = {submit:boolean, acceptStatement:boolean, text:string, textChanged:boolean, files:{changed:boolean, keep:{name,url}[], added:{name:string, size:number}[] (File objects)}}`.
  Behaviour: only changed plugins are sent; text draft itemid from `getUnusedDraftItemId` (falls back to `0` on any error except `network`/`retry`, which propagate); files: kept files are downloaded (`withToken`) and re-uploaded followed by the added ones into one draft area (first upload `itemid: 0`, then the returned id); if nothing remains an empty draft itemid is used; a failed download -> `MoodleError('keepfailed')` **before** any save; after `saveSubmission` succeeds and `input.submit && assignment.drafts`, `submitForGrading(acceptStatement)` runs; with no changes and `submit && drafts` only `submitForGrading` runs; no changes and not `drafts` -> `MoodleError('nochanges')`.

- [ ] **Step 1: Write the failing tests** `tests/submit.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { performSubmission } from '../src/submit.js';
import { MoodleError } from '../src/api.js';

const write = async (fn) => fn({ token: 'T', userid: 1 });
const assignment = (o = {}) => ({ id: 42, drafts: true, plugins: { onlinetext: true, file: true }, ...o });
const FURL = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/foto.jpg';

function fakeApi(over = {}) {
  const calls = [];
  const api = {
    getUnusedDraftItemId: async () => { calls.push(['draftid']); return { itemid: 555 }; },
    uploadDraftFile: async (token, file, opts) => { calls.push(['upload', file.name, opts.itemid]); return { itemid: opts.itemid || 900, filename: file.name }; },
    saveSubmission: async (token, id, plugindata) => { calls.push(['save', id, plugindata]); return []; },
    submitForGrading: async (token, id, accept) => { calls.push(['submit', id, accept]); return []; },
    ...over,
  };
  return { api, calls };
}
const input = (o = {}) => ({ submit: false, acceptStatement: false, text: '', textChanged: false, files: { changed: false, keep: [], added: [] }, ...o });
const file = (name) => ({ name, size: 3, ...new Blob(['abc']) , __blob: new Blob(['abc']) });
const fileObj = (name) => Object.assign(new Blob(['abc']), { name });

test('text-only edit sends only onlinetext_editor (never files) and does not submit', async () => {
  const { api, calls } = fakeApi();
  const r = await performSubmission({ api, write, assignment: assignment(), input: input({ text: 'hola & <b>', textChanged: true }) });
  assert.deepEqual(r, { saved: true, submitted: false });
  assert.deepEqual(calls, [['draftid'], ['save', 42, { onlinetext_editor: { text: '<p>hola &amp; &lt;b&gt;</p>', format: 1, itemid: 555 } }]]);
});

test('draft itemid falls back to 0 on a non-network error but a network error aborts', async () => {
  const a = fakeApi({ getUnusedDraftItemId: async () => { throw new MoodleError('accessexception'); } });
  await performSubmission({ api: a.api, write, assignment: assignment(), input: input({ text: 'x', textChanged: true }) });
  assert.equal(a.calls[0][2].onlinetext_editor.itemid, 0);
  const b = fakeApi({ getUnusedDraftItemId: async () => { throw new MoodleError('network'); } });
  await assert.rejects(() => performSubmission({ api: b.api, write, assignment: assignment(), input: input({ text: 'x', textChanged: true }) }), (e) => e.code === 'network');
  assert.deepEqual(b.calls, []); // nothing saved
});

test('files-only edit re-attaches kept files then uploads new ones into one draft and sends only files_filemanager', async () => {
  const { api, calls } = fakeApi();
  const downloads = [];
  const fetchImpl = async (url) => { downloads.push(url); return { ok: true, blob: async () => new Blob(['old']) }; };
  const r = await performSubmission({
    api, write, fetchImpl, assignment: assignment(),
    input: input({ files: { changed: true, keep: [{ name: 'foto.jpg', url: FURL }], added: [fileObj('nueva.pdf')] } }),
  });
  assert.deepEqual(r, { saved: true, submitted: false });
  assert.deepEqual(downloads, [`${FURL}?token=T`]);
  assert.deepEqual(calls, [['upload', 'foto.jpg', 0], ['upload', 'nueva.pdf', 900], ['save', 42, { files_filemanager: 900 }]]);
});

test('removing every file saves an empty draft area', async () => {
  const { api, calls } = fakeApi();
  await performSubmission({ api, write, assignment: assignment(), input: input({ files: { changed: true, keep: [], added: [] } }) });
  assert.deepEqual(calls, [['draftid'], ['save', 42, { files_filemanager: 555 }]]);
});

test('a kept file that cannot be re-fetched aborts before anything is saved', async () => {
  const { api, calls } = fakeApi();
  const fetchImpl = async () => ({ ok: false, blob: async () => new Blob([]) });
  await assert.rejects(
    () => performSubmission({ api, write, fetchImpl, assignment: assignment(), input: input({ text: 'x', textChanged: true, files: { changed: true, keep: [{ name: 'foto.jpg', url: FURL }], added: [] } }) }),
    (e) => e.code === 'keepfailed',
  );
  assert.ok(!calls.some((c) => c[0] === 'save'));
});

test('text and files together send both plugins', async () => {
  const { api, calls } = fakeApi();
  await performSubmission({ api, write, assignment: assignment(), input: input({ text: 'a', textChanged: true, files: { changed: true, keep: [], added: [fileObj('x.txt')] } }) });
  const save = calls.find((c) => c[0] === 'save');
  assert.deepEqual(Object.keys(save[2]).sort(), ['files_filemanager', 'onlinetext_editor']);
});

test('submit with drafts saves first, then submits with the statement flag; failures stop the chain', async () => {
  const { api, calls } = fakeApi();
  const r = await performSubmission({ api, write, assignment: assignment(), input: input({ submit: true, acceptStatement: true, text: 'a', textChanged: true }) });
  assert.deepEqual(r, { saved: true, submitted: true });
  assert.deepEqual(calls.map((c) => c[0]), ['draftid', 'save', 'submit']);
  assert.equal(calls[2][2], true);

  const bad = fakeApi({ saveSubmission: async () => { throw new MoodleError('submissionclosed', 'Closed'); } });
  await assert.rejects(() => performSubmission({ api: bad.api, write, assignment: assignment(), input: input({ submit: true, text: 'a', textChanged: true }) }), (e) => e.code === 'submissionclosed');
  assert.ok(!bad.calls.some((c) => c[0] === 'submit'));
});

test('submit with no changes only submits the existing draft; without drafts it is "nochanges"', async () => {
  const a = fakeApi();
  const r = await performSubmission({ api: a.api, write, assignment: assignment(), input: input({ submit: true, acceptStatement: false }) });
  assert.deepEqual(r, { saved: false, submitted: true });
  assert.deepEqual(a.calls, [['submit', 42, false]]);
  const b = fakeApi();
  await assert.rejects(() => performSubmission({ api: b.api, write, assignment: assignment({ drafts: false }), input: input({ submit: true }) }), (e) => e.code === 'nochanges');
  assert.deepEqual(b.calls, []);
});

test('without drafts, submit with changes saves only (saving already submits)', async () => {
  const { api, calls } = fakeApi();
  const r = await performSubmission({ api, write, assignment: assignment({ drafts: false }), input: input({ submit: true, text: 'a', textChanged: true }) });
  assert.deepEqual(r, { saved: true, submitted: true });
  assert.ok(!calls.some((c) => c[0] === 'submit'));
});

test('a network error during save propagates and nothing else runs', async () => {
  const { api, calls } = fakeApi({ saveSubmission: async () => { throw new MoodleError('network'); } });
  await assert.rejects(() => performSubmission({ api, write, assignment: assignment(), input: input({ submit: true, text: 'a', textChanged: true }) }), (e) => e.code === 'network');
  assert.ok(!calls.some((c) => c[0] === 'submit'));
});
```
(Remove the unused `file` helper line if lint-ish noise bothers you; `fileObj` is the one used.)

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `src/submit.js`; add `"./src/submit.js",` to `sw.js` SHELL (after `"./src/strings.js",`)

```js
import { MoodleError } from './api.js';
import { withToken } from './content.js';
import { buildPlugindata } from './assign.js';

const PROPAGATE = new Set(['network', 'retry', 'invalidtoken']);

async function draftItemId(write, api) {
  try {
    const r = await write((s) => api.getUnusedDraftItemId(s.token));
    return r && r.itemid != null ? r.itemid : 0;
  } catch (e) {
    if (e && PROPAGATE.has(e.code)) throw e;
    return 0;
  }
}

async function buildFileDraft({ api, write, keep, added, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const queue = [];
  for (const f of keep) {
    const blob = await write(async (s) => {
      let res;
      try {
        res = await doFetch(withToken(f.url, s.token), { credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch {
        throw new MoodleError('keepfailed');
      }
      if (!res.ok) throw new MoodleError('keepfailed');
      return res.blob();
    });
    queue.push({ name: f.name, blob });
  }
  for (const f of added) queue.push({ name: f.name, blob: f });
  if (!queue.length) return draftItemId(write, api);
  let itemid = 0;
  for (const f of queue) {
    const r = await write((s) => api.uploadDraftFile(s.token, f, { itemid }));
    itemid = r.itemid;
  }
  return itemid;
}

export async function performSubmission({ api, write, assignment, input, fetchImpl }) {
  const files = input.files || { changed: false, keep: [], added: [] };
  const wantsSubmit = Boolean(input.submit);
  if (!input.textChanged && !files.changed && wantsSubmit && !assignment.drafts) throw new MoodleError('nochanges');

  // Everything that can fail before anything is written happens first.
  const textItemId = input.textChanged ? await draftItemId(write, api) : undefined;
  const filesItemId = files.changed
    ? await buildFileDraft({ api, write, keep: files.keep, added: files.added, fetchImpl })
    : undefined;

  const plugindata = buildPlugindata({
    text: input.text, textChanged: input.textChanged, textItemId, filesChanged: files.changed, filesItemId,
  });
  const saved = Object.keys(plugindata).length > 0;
  if (saved) await write((s) => api.saveSubmission(s.token, assignment.id, plugindata));
  if (wantsSubmit && assignment.drafts) {
    await write((s) => api.submitForGrading(s.token, assignment.id, Boolean(input.acceptStatement)));
  }
  return { saved, submitted: wantsSubmit };
}
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: write orchestration with only-changed plugins and no replay"
```

---

### Task 5: Assignment screen UI

**Files:**
- Create: `src/ui/assign.js`, `tests/assign-ui.test.js`
- Modify: `src/strings.js`, `src/styles.css`, `sw.js` (add `"./src/ui/assign.js"`)

**Interfaces:**
- Consumes: `formatDue`, `badgeState`, `describeError`, `withToken`, `sanitizeHtml`, `h`.
- Produces: `renderAssign(props) -> HTMLElement (article.course.assign)` where `props = {courseId, assignment, status|null, editability:{editable,reason}, uploadAvailable, maxBytes, draftText:string|null, token, offline, now, locale, flash:''|'saved'|'submitted'|'unknown', actions:{send(input):Promise}, onDone(kind:'saved'|'submitted'|'unknown'), onTextInput(text)}`.
  - `input` passed to `actions.send` is exactly the `performSubmission` input (Task 4).
  - The form exists only when `editability.editable && status && !offline`. **Submit** reveals `.confirm`; only **Confirm** calls `send({submit:true,...})`; single-flight; a `network` error calls `onDone('unknown')` (no success shown); other errors show text inline and re-enable.
  - Strings added (all under `STRINGS`): `backToCourse:'Course'`, `yourAnswer:'Your answer'`, `yourSubmission:'Your submission'`, `saveDraft:'Save draft'`, `submitForGrading:'Submit for grading'`, `submit:'Submit'`, `confirmSubmit:'Yes, submit'`, `cancel:'Cancel'`, `confirmSubmitText:'Submit for grading? You may not be able to edit it afterwards.'`, `confirmSendText:'Send your answer now?'`, `nothingToSend:'Write an answer or add a file first.'`, `replaceFormatted:'Replace with plain text'`, `formattedNote:'This answer has formatting from the website. Editing here replaces it with plain text.'`, `addFiles:'Add files or photos'`, `remove:'Remove'`, `fileTooBig:'File is too large'`, `tooManyFiles:'Too many files'`, `uploadUnavailable:'Uploading files from this app is not available for your account.'`, `savedDraft:'Draft saved.'`, `submittedOk:'Submitted.'`, `unconfirmed:'Could not confirm — the screen was refreshed so you can check the status.'`, `noDueDate:'No due date'`, `states:{notsubmitted:'Not submitted',draft:'Draft',submitted:'Submitted',graded:'Graded'}`, `readonly:{team:'Group submissions are not supported in this app yet.',nosubmissions:'This task has no online submission.',noplugins:'This task accepts no online answer.',notopen:'Submissions are not open yet.',locked:'Submissions are locked.',cutoff:'The deadline has passed.',submitted:'Submitted. Ask your teacher to reopen it if you need to change it.',notallowed:'You cannot edit this submission.'}`, `offlineNoEdit:'You are offline. Editing is available when you are back online.'`, `gradeLabel:'Grade'`, `feedbackLabel:'Feedback'`, `assignNotFound:'This task was not found in the course.'`, `testUpload:'Test upload'`, `testing:'Testing…'`.

- [ ] **Step 1: Write the failing tests** `tests/assign-ui.test.js`

```js
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
  sent.length = 0;
  btn(el, 'Replace with plain text').click();
  assert.equal(ta.disabled, false);
  ta.value = 'hola mundo';
  btn(el, 'Save draft').click();
  await tick();
  assert.equal(sent[0].textChanged, true);
  el.remove();
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
```
(Delete the stray unused `file` helper in Task 4's test if you copied it; the UI test file above has none.)

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../src/ui/assign.js'`).

- [ ] **Step 3: Implement.** Add the strings listed under Interfaces to `src/strings.js` (top level keys; nested `states` and `readonly` objects as written). Add `"./src/ui/assign.js",` to `sw.js` SHELL (after `"./src/ui/course.js",`... keep alphabetical: before `"./src/ui/course.js"`). Create `src/ui/assign.js`:

```js
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
  const restored = p.draftText != null;
  let replaceFormatted = existing.simple || restored;
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
  const replaceBtn = textarea && !replaceFormatted
    ? h('button', {
      type: 'button', class: 'btn secondary',
      onclick: () => {
        replaceFormatted = true;
        textarea.disabled = false;
        replaceBtn.hidden = true;
        formattedNote.hidden = true;
        textarea.focus();
      },
    }, S.replaceFormatted)
    : null;

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
  const fileInput = a.plugins.file && p.uploadAvailable
    ? h('input', {
      type: 'file', multiple: true, 'aria-label': S.addFiles,
      onchange: () => {
        for (const f of Array.from(fileInput.files || [])) {
          if (p.maxBytes && f.size > p.maxBytes) { say(`${S.fileTooBig} (${f.name})`); continue; }
          if (a.maxFiles && kept.length + added.length >= a.maxFiles) { say(S.tooManyFiles); break; }
          added.push(f);
        }
        fileInput.value = '';
        renderFiles();
      },
    })
    : null;
  if (a.plugins.file) renderFiles();

  const hasContent = () => (textarea && textarea.value.trim() !== '') || kept.length + added.length > 0;
  const collect = (submit, acceptStatement) => ({
    submit,
    acceptStatement,
    text: textarea ? textarea.value : '',
    textChanged: Boolean(textarea) && replaceFormatted && textarea.value !== existing.plain,
    files: { changed: removedAny || added.length > 0, keep: kept.map((f) => ({ name: f.name, url: f.url })), added: added.slice() },
  });
  const setBusy = (b) => { busy = b; for (const x of buttons) x.disabled = b; };
  const run = async (submit, acceptStatement) => {
    if (busy) return;
    setBusy(true);
    say('');
    try {
      await p.actions.send(collect(submit, acceptStatement));
      p.onDone(submit ? 'submitted' : 'saved');
    } catch (err) {
      if (err && err.code === 'network') { p.onDone('unknown'); return; }
      say(errorText(err));
      setBusy(false);
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
      if (!hasContent() && !canSubmitExistingDraft) { say(S.nothingToSend); return; }
      say('');
      confirm.hidden = false;
    },
  }, a.drafts ? S.submitForGrading : S.submit);
  const saveBtn = a.drafts
    ? h('button', { type: 'button', class: 'btn secondary', onclick: () => { if (!hasContent()) { say(S.nothingToSend); return; } run(false, false); } }, S.saveDraft)
    : null;
  for (const b of [saveBtn, submitBtn, confirmBtn, cancelBtn, replaceBtn]) if (b) buttons.push(b);

  return h('form', { class: 'answer-form', novalidate: true, onsubmit: (e) => e.preventDefault() },
    textarea, formattedNote, replaceBtn,
    a.plugins.file ? (fileInput ? h('div', { class: 'files-box' }, fileList, fileInput) : h('p', { class: 'note' }, S.uploadUnavailable)) : null,
    msg, h('div', { class: 'actions' }, saveBtn, submitBtn), confirm);
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
```
Append to `src/styles.css`:
```css
/* Assignment screen */
.assign > section, .assign > .intro, .assign > .links, .assign-meta { margin: 0 16px 14px; }
.assign-meta { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.badge { padding: 2px 12px; border-radius: 999px; font-size: 14px; font-weight: 700; background: var(--bg); border: 1px solid var(--border); }
.badge-draft { border-color: var(--accent); color: var(--accent); }
.badge-submitted, .badge-graded { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.due.overdue { color: var(--danger); font-weight: 600; }
.answer-form textarea { width: 100%; min-height: 160px; padding: 12px; font: inherit; font-size: 17px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); }
.answer-form .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.answer-form .btn { margin-top: 0; flex: 1 1 140px; }
.btn.secondary { background: var(--surface); color: var(--accent); border: 1px solid var(--accent); }
.confirm { margin-top: 12px; padding: 14px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
.confirm .btn { width: 100%; margin: 8px 0 0; }
.note { color: var(--muted); font-size: 15px; }
.flash-submitted, .flash-saved { border-color: var(--accent); color: var(--text); }
.files-box { margin-top: 12px; }
.files .remove { min-height: 32px; }
.grade { font-weight: 700; }
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: assignment screen with confirm-before-submit and single-flight writes"
```

---

### Task 6: Course page links to assignments

**Files:**
- Modify: `src/content.js`, `src/ui/course.js`, `tests/fixtures.js`, `tests/content.test.js`, `tests/ui.test.js`

**Interfaces:**
- Produces:
  - `buildCourse`: `modname: 'assign'` modules become `{kind:'assign', ...base}` (`links: []`, **not** `unsupported`, no `soon`). `quiz`/`forum` stay "coming soon".
  - `renderCourse({course, token, offline, dues?, now?, locale?})` — `dues` is `{[cmid]: dueSeconds}`; each assign module renders `li.mod.assign` with a `Exercise` chip, `a.assign-link[href="#/course/<course.id>/assign/<module.id>"]` and, when a due date is known, `small.due` (`.overdue` when past).

- [ ] **Step 1: Update fixtures and write the failing tests**

In `tests/fixtures.js` add to section 101's `modules` (after the glossary line): `{ id: 9, name: 'Tarea 1', modname: 'assign', uservisible: true, description: '' },`.

In `tests/content.test.js`, in the test `modules carry modname; assign/quiz/forum are marked soon; other unsupported types are not`, change the final `deepEqual` to expect `assign` no longer soon:
```js
  assert.deepEqual(v[0].modules.map((m) => [m.modname, Boolean(m.soon)]), [['assign', false], ['quiz', true], ['', false]]);
```
and rename the test to `...quiz/forum are marked soon...`. Append:
```js
test('assign modules become their own kind and are not coming soon', () => {
  const [, unit] = buildCourse(sampleSections, 'T');
  const tarea = unit.modules.find((m) => m.name === 'Tarea 1');
  assert.equal(tarea.kind, 'assign');
  assert.equal(tarea.unsupported, undefined);
  assert.equal(tarea.soon, undefined);
  assert.deepEqual(tarea.links, []);
});
```
Append to `tests/ui.test.js`:
```js
test('assign modules link to the assignment route and show a due date when known', () => {
  const sections = buildCourse(sampleSections, 'T');
  const NOW = 1785000000;
  const el = renderCourse({ course: { id: 11, fullname: 'X', sections }, token: 'T', dues: { 9: NOW + 2 * 86400 }, now: NOW, locale: 'en' });
  const link = el.querySelector('a.assign-link');
  assert.equal(link.getAttribute('href'), '#/course/11/assign/9');
  assert.equal(link.textContent, 'Tarea 1');
  const mod = link.closest('li.mod');
  assert.equal(mod.querySelector('.chip').textContent, 'Exercise');
  assert.match(mod.querySelector('small.due').textContent, /in 2 days/);
  const overdue = renderCourse({ course: { id: 11, fullname: 'X', sections }, token: 'T', dues: { 9: NOW - 3600 }, now: NOW, locale: 'en' });
  assert.ok(overdue.querySelector('small.due.overdue'));
  const none = renderCourse({ course: { id: 11, fullname: 'X', sections }, token: 'T' });
  assert.equal(none.querySelector('small.due'), null);
});
```

- [ ] **Step 2: Run, expect FAIL** (assign still `soon`; no `.assign-link`).

- [ ] **Step 3: Implement**

`src/content.js`: change `const SOON = new Set(['assign', 'quiz', 'forum']);` to `const SOON = new Set(['quiz', 'forum']);` and add a case before `default:` in `buildModule`:
```js
    case 'assign':
      return { ...base, kind: 'assign' };
```
`src/ui/course.js`: add `import { formatDue } from '../assign.js';`, change `renderModule(m, opts)` to `renderModule(m, opts, ctx)`, and insert at the top of `renderModule` (after the label branch):
```js
  if (m.kind === 'assign') {
    const due = ctx.dues && ctx.dues[m.id] ? formatDue(ctx.dues[m.id], ctx.now, ctx.locale) : null;
    return h('li', { class: 'mod assign' },
      h('div', { class: 'mod-head' }, chip(m), h('a', { class: 'assign-link', href: `#/course/${ctx.courseId}/assign/${m.id}` }, m.name)),
      due && due.has ? h('small', { class: due.overdue ? 'due overdue' : 'due' }, `${due.relative} · ${due.absolute}`) : null,
      m.description ? html('html small', m.description, opts) : null);
  }
```
Update `renderSection(s, open, opts)` to take and forward `ctx` (`renderSection(s, open, opts, ctx)` -> `renderModule(m, opts, ctx)`), and in `renderCourse` add `dues, now, locale` to the destructured props and build `const ctx = { courseId: course.id, dues, now, locale };`, passing it to `renderSection(s, i === firstOpen, opts, ctx)`. (`chip(m)` already labels `assign` as "Exercise" via `S.types.assign`.)

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: course page links assignments with due dates"
```

---

### Task 7: Diagnostics Test upload button

**Files:**
- Modify: `src/ui/diagnostics.js`, `tests/diagnostics-ui.test.js`

**Interfaces:**
- Produces: `renderDiagnostics({run, clipboard?, onUploadTest?})` — when `onUploadTest` (`() => Promise<string>`) is provided a `button.upload-test` (`STRINGS.testUpload`) renders under Copy; tapping it disables it, shows `STRINGS.testing`, awaits the line, appends `\n\n<line>` to `pre.report` (so Copy includes it) and re-enables; a rejected promise appends `Upload test: error`. It never runs automatically.

- [ ] **Step 1: Write the failing tests** (append to `tests/diagnostics-ui.test.js`)

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (no `.upload-test`).

- [ ] **Step 3: Implement.** In `src/ui/diagnostics.js` change the signature to `renderDiagnostics({ run, clipboard = ..., onUploadTest })`, and before building `el` add:
```js
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
```
and include `uploadBtn` (as `...(uploadBtn ? [uploadBtn] : [])`) after `btn` in the `h('article', ...)` children. Add `.diagnostics .upload-test { width: calc(100% - 32px); margin: 10px 16px 0; }` to `src/styles.css`.

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: user-run Test upload in Diagnostics"
```

---

### Task 8: App wiring (route, loaders, writes, sign-out, service worker)

**Files:**
- Modify: `src/app.js` (replace), `src/main.js`, `sw.js` (`VERSION = "v3"`), `tests/app.test.js`, `tests/fixtures.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `createApp({root, api, auth, cache, win?, folderState?, drafts?, locale?, nowFn?})` (`drafts` defaults to an in-memory `createDrafts`, `nowFn` returns Unix seconds). Route `#/course/<c>/assign/<cmid>` (detail pane, `has-detail`). Reads go through `call()`; writes go through `callWrite()` which never replays: on `invalidtoken` it tries `auth.relogin()` and then throws `MoodleError('retry')` (or `invalidtoken` if nothing was saved / saved password rejected). Sign-out also calls `drafts.clear()`. `uploadOk` flag lives in `cache` (`cache.set('uploadOk', bool)`), so sign-out clears it.

- [ ] **Step 1: Add fixtures and write the failing tests**

Append to `tests/fixtures.js`:
```js
const cfg = (plugin, v) => ({ plugin, subtype: 'assignsubmission', name: 'enabled', value: v });

export const sampleAssignmentsResponse = {
  courses: [{ id: 11, assignments: [
    { id: 42, cmid: 9, name: 'Tarea 1', intro: '<p>Escribe un párrafo sobre tu ciudad.</p>', duedate: 1785172800, cutoffdate: 0, allowsubmissionsfromdate: 0,
      submissiondrafts: 1, requiresubmissionstatement: 0, teamsubmission: 0, nosubmissions: 0, configs: [cfg('onlinetext', '1'), cfg('file', '1')], introattachments: [] },
  ] }],
};

export const sampleStatusResponse = {
  lastattempt: { submission: { status: 'draft', plugins: [{ type: 'onlinetext', editorfields: [{ text: '<p>Mi ciudad es bonita.</p>' }] }, { type: 'file', fileareas: [{ area: 'submission_files', files: [] }] }] }, canedit: true, cansubmit: true },
};
```
In `tests/app.test.js`: add `sampleAssignmentsResponse, sampleStatusResponse` to the fixtures import, extend `setup()` so `api` defaults include
```js
    getAssignments: async () => sampleAssignmentsResponse,
    getSubmissionStatus: async () => sampleStatusResponse,
    getUnusedDraftItemId: async () => ({ itemid: 555 }),
    saveSubmission: async () => [],
    submitForGrading: async () => [],
    uploadDraftFile: async (t, f) => ({ itemid: 900, filename: f.name }),
    deleteDraftFiles: async () => [],
```
(before `...apiOverrides`), add `const drafts = createDrafts(storage);` (import `createDrafts` from `../src/drafts.js` via `await import`) passed to `createApp({ ..., drafts, nowFn: () => 1785000000, locale: 'en' })`, and return `drafts` and `storage` from `setup`. Then append:
```js
const goAssign = async (app, win) => { win.location.hash = '#/course/11/assign/9'; await app.showRoute(); await tick(); await tick(); };

test('the course page lists the assignment with its due date and links to it', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  await tick();
  const link = root.querySelector('a.assign-link');
  assert.ok(link);
  assert.equal(link.getAttribute('href'), '#/course/11/assign/9');
  assert.match(link.closest('li').querySelector('small.due').textContent, /in 2 days/);
});

test('the assignment route renders the screen with the existing answer', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  await goAssign(app, win);
  assert.ok(root.querySelector('.shell.has-detail'));
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Tarea 1');
  assert.equal(root.querySelector('.pane-detail textarea').value, 'Mi ciudad es bonita.');
  assert.equal(root.querySelector('.badge').textContent, 'Draft');
});

test('Save draft sends only the changed text, clears the local draft and shows a flash', async () => {
  const saves = [];
  const { app, root, win, drafts } = setup({ saveSubmission: async (t, id, pd) => { saves.push([id, pd]); return []; } }, true);
  await app.start();
  await goAssign(app, win);
  const ta = root.querySelector('textarea');
  ta.value = 'Mi ciudad es muy bonita.';
  ta.dispatchEvent(new window.Event('input'));
  assert.equal(drafts.get(42).text, 'Mi ciudad es muy bonita.');
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save draft').click();
  await tick(); await tick(); await tick(); await tick();
  assert.equal(saves.length, 1);
  assert.deepEqual(Object.keys(saves[0][1]), ['onlinetext_editor']);
  assert.equal(saves[0][1].onlinetext_editor.text, '<p>Mi ciudad es muy bonita.</p>');
  assert.equal(drafts.get(42), null);
  assert.match(root.querySelector('.flash').textContent, /Draft saved/);
});

test('Submit asks for confirmation, then saves and submits', async () => {
  const seq = [];
  const { app, root, win } = setup({
    saveSubmission: async () => { seq.push('save'); return []; },
    submitForGrading: async () => { seq.push('submit'); return []; },
  }, true);
  await app.start();
  await goAssign(app, win);
  const ta = root.querySelector('textarea');
  ta.value = 'Texto final';
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Submit for grading').click();
  assert.deepEqual(seq, []);
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Yes, submit').click();
  await tick(); await tick(); await tick(); await tick();
  assert.deepEqual(seq, ['save', 'submit']);
  assert.match(root.querySelector('.flash').textContent, /Submitted/);
});

test('a network failure during a write refreshes the screen and says it could not confirm', async () => {
  const { app, root, win } = setup({ saveSubmission: async () => { throw new MoodleError('network'); } }, true);
  await app.start();
  await goAssign(app, win);
  const ta = root.querySelector('textarea');
  ta.value = 'x y z';
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save draft').click();
  await tick(); await tick(); await tick(); await tick();
  assert.match(root.querySelector('.flash').textContent, /Could not confirm/);
});

test('an expired token during a write renews the session but does not replay the write', async () => {
  let saves = 0;
  const { app, root, win, vault } = setup({
    saveSubmission: async () => { saves += 1; throw new MoodleError('invalidtoken'); },
    requestToken: async () => 'fresh',
  }, true);
  await vault.save('u', 'pw');
  await app.start();
  await goAssign(app, win);
  const ta = root.querySelector('textarea');
  ta.value = 'algo';
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save draft').click();
  await tick(); await tick(); await tick(); await tick();
  assert.equal(saves, 1); // never replayed
  assert.match(root.querySelector('.form-msg').textContent, /tap again/);
});

test('offline with a cached assignment shows a read-only view', async () => {
  const { app, root, win, cache } = setup({ getAssignments: async () => { throw new MoodleError('network'); } }, true);
  cache.set('assigns:11', sampleAssignmentsResponse.courses[0].assignments);
  await app.start();
  await goAssign(app, win);
  assert.equal(root.querySelector('.pane-detail form'), null);
  assert.match(root.querySelector('.pane-detail').textContent, /offline/i);
});

test('a task that is not in the course shows a not-found message', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11/assign/777';
  await app.showRoute();
  await tick(); await tick();
  assert.match(root.querySelector('.pane-detail').textContent, /not found/);
});

test('sign-out clears local drafts and the upload flag', async () => {
  const { app, drafts, cache } = setup({}, true);
  await app.start();
  drafts.set(42, 'borrador');
  cache.set('uploadOk', false);
  app.logout();
  await tick();
  assert.equal(drafts.get(42), null);
  assert.equal(cache.get('uploadOk'), null);
});

test('Test upload: success sets the flag and reports ok; failure records the error code and hides file upload afterwards', async () => {
  const deleted = [];
  const ok = setup({ deleteDraftFiles: async (t, id, files) => { deleted.push([id, files]); return []; } }, true);
  await ok.app.start();
  ok.win.location.hash = '#/diagnostics';
  await ok.app.showRoute();
  await tick(); await tick(); await tick();
  ok.root.querySelector('button.upload-test').click();
  await tick(); await tick(); await tick();
  assert.match(ok.root.querySelector('pre.report').textContent, /Upload test: ok$/);
  assert.equal(ok.cache.get('uploadOk').data, true);
  assert.equal(deleted.length, 1);

  const bad = setup({ uploadDraftFile: async () => { throw new MoodleError('nopermissions'); } }, true);
  await bad.app.start();
  bad.win.location.hash = '#/diagnostics';
  await bad.app.showRoute();
  await tick(); await tick(); await tick();
  bad.root.querySelector('button.upload-test').click();
  await tick(); await tick(); await tick();
  assert.match(bad.root.querySelector('pre.report').textContent, /Upload test: nopermissions$/);
  assert.equal(bad.cache.get('uploadOk').data, false);
  await goAssign(bad.app, bad.win);
  assert.equal(bad.root.querySelector('input[type=file]'), null);
  assert.match(bad.root.querySelector('.pane-detail').textContent, /not available for your account/);
});
```

- [ ] **Step 2: Run, expect FAIL** (no route, `createDrafts` unused, no Test upload wiring).

- [ ] **Step 3: Implement.** Replace `src/app.js` with the current file plus these changes (shown as a complete file so nothing is ambiguous):

```js
import { clear, h } from './ui/dom.js';
import { renderLogin } from './ui/login.js';
import { renderCourseList } from './ui/courses.js';
import { renderCourse, renderBack } from './ui/course.js';
import { renderDiagnostics } from './ui/diagnostics.js';
import { renderAssign } from './ui/assign.js';
import { buildCourse } from './content.js';
import { loadCourseList } from './courses.js';
import { runDiagnostics, buildReport } from './diagnostics.js';
import { parseAssignment, parseStatus, editability } from './assign.js';
import { performSubmission } from './submit.js';
import { createFolderState } from './folders.js';
import { createDrafts } from './drafts.js';
import { createMemoryStorage } from './storage.js';
import { describeError } from './errors.js';
import { MoodleError } from './api.js';
import { STRINGS as S } from './strings.js';

const assignmentsOf = (res) => (res && Array.isArray(res.courses) && res.courses[0] && Array.isArray(res.courses[0].assignments) ? res.courses[0].assignments : []);
const safeCode = (c) => (typeof c === 'string' && /^[a-z][a-z_]{1,60}$/.test(c) ? c : 'error');

export function createApp({
  root, api, auth, cache, win = globalThis.window,
  folderState = createFolderState(createMemoryStorage()),
  drafts = createDrafts(createMemoryStorage()),
  locale = globalThis.navigator && globalThis.navigator.language,
  nowFn = () => Math.floor(Date.now() / 1000),
}) {
  let courses = [];
  let lastList = null; // last loaded { courses, source, raw }; reused by Diagnostics
  let offline = false;
  let shell = null;
  let listPane = null;
  let detailPane = null;
  let pendingFlash = '';
  let siteMaxUpload = null;

  const view = () => {
    const hash = win.location.hash;
    if (hash === '#/diagnostics') return { type: 'diagnostics' };
    let m = /^#\/course\/(\d+)\/assign\/(\d+)$/.exec(hash);
    if (m) return { type: 'assign', courseId: Number(m[1]), cmid: Number(m[2]) };
    m = /^#\/course\/(\d+)$/.exec(hash);
    return m ? { type: 'course', id: Number(m[1]) } : { type: 'list' };
  };
  const route = () => {
    const v = view();
    if (v.type === 'course') return v.id;
    return v.type === 'assign' ? v.courseId : null;
  };

  function showLogin(message = '') {
    shell = null;
    clear(root).append(renderLogin({ message, onSubmit: login }));
  }

  async function login(username, password) {
    await auth.login(username, password); // rejection is shown by the login form
    await showShell();
  }

  function logout(message = '') {
    auth.logout();
    cache.clear();
    drafts.clear();
    courses = [];
    lastList = null;
    siteMaxUpload = null;
    pendingFlash = '';
    showLogin(message);
    if (win.location.hash) win.location.hash = '';
  }

  // Run an authenticated read. On an expired token, silently renew it from the
  // saved credentials and retry exactly once.
  async function call(fn) {
    try {
      return await fn(auth.getSession());
    } catch (err) {
      if (!err || err.code !== 'invalidtoken') throw err;
      let fresh;
      try {
        fresh = await auth.relogin();
      } catch (reErr) {
        // Saved password rejected -> treat as a dead session; anything else (network) propagates.
        if (reErr && reErr.code === 'invalidlogin') throw new MoodleError('invalidtoken');
        throw reErr;
      }
      if (!fresh) throw err; // nothing saved
      return fn(fresh);
    }
  }

  // Run an authenticated WRITE exactly once. On an expired token the session is renewed
  // but the write is never replayed: the user is asked to tap again.
  async function callWrite(fn) {
    try {
      return await fn(auth.getSession());
    } catch (err) {
      if (!err || err.code !== 'invalidtoken') throw err;
      let fresh;
      try {
        fresh = await auth.relogin();
      } catch (reErr) {
        if (reErr && reErr.code === 'invalidlogin') throw new MoodleError('invalidtoken');
        throw reErr;
      }
      if (!fresh) throw err;
      throw new MoodleError('retry');
    }
  }

  function handleFatal(err) {
    if (err && err.code === 'invalidtoken') {
      logout(S.errors.invalidtoken);
      return true;
    }
    return false;
  }

  function renderList() {
    const { token } = auth.getSession();
    clear(listPane).append(
      h('header', { class: 'bar' },
        h('h1', {}, S.courses),
        h('a', { class: 'link', href: '#/diagnostics' }, S.diagnostics),
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout)),
      ...(offline ? [h('p', { class: 'banner' }, S.offline)] : []),
      renderCourseList({ courses, token, selectedId: route(), folderState }));
  }

  async function loadCourses() {
    const epoch = auth.epoch();
    try {
      const res = await call((s) => loadCourseList({ api, token: s.token, userid: s.userid }));
      if (auth.epoch() !== epoch) return false; // signed out meanwhile: drop the result
      courses = res.courses;
      lastList = res;
      cache.set('courses', courses);
      offline = false;
    } catch (err) {
      if (auth.epoch() !== epoch) return false;
      if (handleFatal(err)) return false;
      const saved = cache.get('courses');
      if (!saved) {
        clear(listPane).append(
          h('p', { class: 'error' }, describeError(err)),
          h('button', { class: 'btn retry', type: 'button', onclick: () => showShell() }, S.retry));
        return false;
      }
      courses = saved.data;
      lastList = null;
      offline = true;
    }
    return true;
  }

  async function showShell() {
    const session = auth.getSession();
    if (!session) return showLogin();
    listPane = h('aside', { class: 'pane-list' }, h('p', { class: 'status' }, S.loading));
    detailPane = h('main', { class: 'pane-detail' });
    shell = h('div', { class: 'shell' }, listPane, detailPane);
    clear(root).append(shell);
    if (await loadCourses()) await showRoute();
    return undefined;
  }

  async function uploadLimit(assignment) {
    if (!assignment.plugins.file) return 0;
    if (siteMaxUpload === null) {
      try {
        const info = await call((s) => api.getSiteInfo(s.token));
        siteMaxUpload = Number(info && info.usermaxuploadfilesize) || 0;
      } catch {
        return assignment.maxBytes || 0; // unknown: the server enforces its own limit
      }
    }
    const limits = [siteMaxUpload, assignment.maxBytes].filter((n) => n > 0);
    return limits.length ? Math.min(...limits) : 0;
  }

  async function uploadTest() {
    try {
      const r = await callWrite((s) => api.uploadDraftFile(s.token, { name: 'aules-app-test.txt', blob: new Blob(['x'], { type: 'text/plain' }) }, { itemid: 0 }));
      try {
        await callWrite((s) => api.deleteDraftFiles(s.token, r.itemid, [{ filepath: '/', filename: r.filename || 'aules-app-test.txt' }]));
      } catch { /* cleanup is best effort; Moodle clears stale drafts itself */ }
      cache.set('uploadOk', true);
      return 'Upload test: ok';
    } catch (err) {
      if (err && err.code !== 'network' && err.code !== 'retry') cache.set('uploadOk', false);
      return `Upload test: ${safeCode(err && err.code)}`;
    }
  }

  async function send(assignment, input, epoch) {
    const result = await performSubmission({ api, write: callWrite, assignment, input });
    if (auth.epoch() === epoch) drafts.remove(assignment.id);
    return result;
  }

  async function showAssign(courseId, cmid, session) {
    const epoch = auth.epoch();
    const flash = pendingFlash;
    pendingFlash = '';
    const here = () => { const v = view(); return v.type === 'assign' && v.cmid === cmid; };
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}` }, '‹ ', S.backToCourse);
    let rawList;
    let offlineList = false;
    try {
      rawList = assignmentsOf(await call((s) => api.getAssignments(s.token, courseId)));
      if (auth.epoch() !== epoch) return;
      cache.set(`assigns:${courseId}`, rawList);
    } catch (err) {
      if (auth.epoch() !== epoch) return;
      if (handleFatal(err)) return;
      const saved = cache.get(`assigns:${courseId}`);
      if (!saved) {
        if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(err)));
        return;
      }
      rawList = saved.data;
      offlineList = true;
    }
    const rawA = rawList.find((x) => x && x.cmid === cmid);
    if (!rawA) {
      if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, S.assignNotFound));
      return;
    }
    const assignment = parseAssignment(rawA);
    let status = null;
    let isOffline = offlineList;
    if (!offlineList) {
      try {
        const rawS = await call((s) => api.getSubmissionStatus(s.token, assignment.id));
        if (auth.epoch() !== epoch) return;
        status = parseStatus(rawS);
      } catch (err) {
        if (auth.epoch() !== epoch) return;
        if (handleFatal(err)) return;
        isOffline = true;
      }
    }
    const maxBytes = await uploadLimit(assignment);
    if (auth.epoch() !== epoch || !here()) return;
    const live = auth.getSession() || session;
    const up = cache.get('uploadOk');
    const draft = drafts.get(assignment.id);
    clear(detailPane).append(renderAssign({
      courseId,
      assignment,
      status,
      editability: status ? editability(assignment, status, nowFn()) : { editable: false, reason: 'notallowed' },
      uploadAvailable: !(up && up.data === false),
      maxBytes,
      draftText: draft ? draft.text : null,
      token: live.token,
      offline: isOffline,
      now: nowFn(),
      locale,
      flash,
      actions: { send: (input) => send(assignment, input, epoch) },
      onDone: (kind) => { pendingFlash = kind; showRoute(); },
      onTextInput: (t) => drafts.set(assignment.id, t),
    }));
  }

  async function showRoute() {
    const session = auth.getSession();
    if (!session || !shell) return;
    const v = view();
    const id = v.type === 'course' ? v.id : null;
    shell.classList.toggle('has-detail', v.type !== 'list');
    renderList();
    if (v.type === 'diagnostics') {
      clear(detailPane).append(renderDiagnostics({
        run: async () => {
          try {
            return buildReport(await runDiagnostics({ api, call, list: lastList }));
          } catch (err) {
            if (handleFatal(err)) return '';
            throw err;
          }
        },
        onUploadTest: uploadTest,
      }));
      return;
    }
    if (v.type === 'assign') {
      await showAssign(v.courseId, v.cmid, session);
      return;
    }
    if (id === null) {
      clear(detailPane).append(h('p', { class: 'placeholder' }, S.pickCourse));
      return;
    }
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    const epoch = auth.epoch();
    let sections;
    let fromCache = false;
    try {
      sections = await call((s) => api.getCourseContents(s.token, id));
      if (auth.epoch() !== epoch) return; // signed out meanwhile: drop the result
      cache.set(`course:${id}`, sections);
    } catch (err) {
      if (auth.epoch() !== epoch) return;
      if (handleFatal(err)) return;
      const saved = cache.get(`course:${id}`);
      if (!saved) {
        if (route() === id) clear(detailPane).append(renderBack(), h('p', { class: 'error' }, describeError(err)));
        return;
      }
      sections = saved.data;
      fromCache = true;
    }
    if (route() !== id) return; // user navigated away while loading
    // Optional: due dates for assignments (never blocks or fails the course page).
    let dues = {};
    try {
      const list = assignmentsOf(await call((s) => api.getAssignments(s.token, id)));
      cache.set(`assigns:${id}`, list);
      dues = Object.fromEntries(list.filter((a) => a && a.cmid != null).map((a) => [a.cmid, Number(a.duedate) || 0]));
    } catch {
      const saved = cache.get(`assigns:${id}`);
      if (saved) dues = Object.fromEntries(saved.data.filter((a) => a && a.cmid != null).map((a) => [a.cmid, Number(a.duedate) || 0]));
    }
    if (auth.epoch() !== epoch || route() !== id) return;
    const info = courses.find((c) => c.id === id);
    const live = auth.getSession() || session; // token may have been renewed during the call
    clear(detailPane).append(renderCourse({
      course: {
        id,
        fullname: info ? info.fullname : '',
        progress: info ? info.progress : null,
        sections: buildCourse(sections, live.token),
      },
      token: live.token,
      offline: fromCache,
      dues,
      now: nowFn(),
      locale,
    }));
  }

  async function start() {
    win.addEventListener('hashchange', () => { if (shell) showRoute(); });
    if (auth.getSession()) await showShell();
    else showLogin();
  }

  return { start, login, logout, showRoute };
}
```
`src/main.js`: add `import { createDrafts } from './drafts.js';` and pass `drafts: createDrafts(storage),` to `createApp`. `sw.js`: set `const VERSION = "v3";`.

- [ ] **Step 4: Run `npm test`, expect PASS.** If `assign x2`-style existing diagnostics test or course-progress tests regress because the course page now makes an extra `getAssignments` call, check that `setup()` defaults include `getAssignments` (added in Step 1). Commit:
```bash
git add -A && git commit -m "feat: assignment route, no-replay writes, upload test and draft clearing"
```

---

### Task 9: Preview data, README and visual verification

**Files:**
- Modify: `tools/preview.js`, `README.md`

**Interfaces:**
- Produces: the demo (`/tools/preview.html`) serves a fake assignment end to end with no network.

- [ ] **Step 1: Update `tools/preview.js`**

Import `sampleAssignmentsResponse, sampleStatusResponse` from `../tests/fixtures.js` and add to the demo `api`:
```js
  getAssignments: async () => sampleAssignmentsResponse,
  getSubmissionStatus: async () => sampleStatusResponse,
  getUnusedDraftItemId: async () => ({ itemid: 555 }),
  saveSubmission: async () => [],
  submitForGrading: async () => [],
  uploadDraftFile: async (token, file) => ({ itemid: 900, filename: file.name }),
  deleteDraftFiles: async () => [],
```
and pass `drafts: createDrafts(createMemoryStorage())` (import `createDrafts` from `../src/drafts.js`) to `createApp`. In the preview fixtures the demo course's contents contain a `Tarea 1` assign module (cmid 9) from Task 6, and the assignment fixture is for course 11, so open the demo course "Gramática A1" (id 11).

- [ ] **Step 2: Update `README.md`:** replace the "What is coming" section with: a "Exercises" paragraph (open an assignment from a course; typed answers, **Save draft** vs **Submit** with a confirmation, local draft protection, file/photo upload only if your account allows it — run **Diagnostics -> Test upload**), the write-safety rules in one short list, and "Still to come: quizzes and forums".

- [ ] **Step 3: Run `npm test`, expect PASS.**

- [ ] **Step 4: Visual check.** Run `npm run serve` (background) and in the Browser pane open `http://localhost:8080/tools/preview.html#/course/11`:
  - `mobile` (375x812): the course page shows `Exercise` chip + "Tarea 1" link with a relative due date; tap it: title, status badge "Draft", instructions, answer box prefilled "Mi ciudad es bonita.", file input, **Save draft** / **Submit for grading**; tap Submit: the confirm panel appears and nothing is sent until "Yes, submit"; Save draft shows "Draft saved."; no horizontal scroll; text 17px; buttons >= 44px.
  - `tablet` (768x1024): course list left, assignment right; back link hidden.
  - Dark scheme: readable contrast; overdue colour visible by editing the fixture due date to the past if needed.
  - Diagnostics: **Test upload** button present; tap it (demo api): the report gains "Upload test: ok".
  Fix any layout bug in `src/styles.css` (add a guard test if it is a selector collision), re-run `npm test`, restore the `desktop` preset, stop the server.

- [ ] **Step 5: Commit** (do **not** push):
```bash
git add -A && git commit -m "docs: README and demo assignment data"
```
- [ ] **Step 6: Hand off to the user:** summarise; state nothing is pushed; ask permission to push; tell them the steps for their phone: update the app, open **Diagnostics -> Test upload** and paste the report; open the assignment, check the existing text appears, and only then try **Save draft** on a real assignment they are comfortable editing (nothing is submitted without the confirm).

---

## Self-Review (done)

- **Spec coverage:** assignment route + screen with instructions/attachments/dates/status/grade/feedback (Tasks 5, 8); typed answer incl. formatted-text lock and plain-text replace (2, 5); drafts vs Submit with confirm, statement checkbox, no-drafts mode (4, 5); single-flight, no replay, unknown-outcome refresh (4, 5, 8); only-changed plugins incl. retained-file re-attach and abort (4); locked/cutoff/team/nosubmissions/notopen/noplugins/submitted states (2, 5); local draft protection and sign-out clearing (3, 8); file upload gated on `uploadOk`, size/count limits, camera/Files via `accept` default (5, 8); Test upload in Diagnostics with cleanup (7, 8); `warnings` as failures (1); sanitized HTML everywhere (5); due dates on the course page (6, 8); offline read-only (8). `assigngva`, quizzes, forums, team and rich text remain out of scope as specified. No gaps found.
- **Placeholders:** none; every code step is complete. (`tests/submit.test.js` contains one unused helper `file` which can be deleted; it does not affect results.)
- **Type consistency:** `performSubmission` input shape (`submit, acceptStatement, text, textChanged, files:{changed, keep, added}`) is produced by `ui/assign.js` `collect()` and consumed by `submit.js` and tested in both; `parseAssignment`/`parseStatus`/`editability` field names match across `assign.js`, `ui/assign.js` and `app.js`; `flash` kinds `saved|submitted|unknown` match between UI `onDone` and app `pendingFlash`; `cache` key `uploadOk` stores a boolean read as `cache.get('uploadOk').data`; module `id` is the cmid used by both the course link and `getAssignments` `cmid`.
- **Review Focus coverage:** 1 -> Task 4 tests; 2 -> Task 2 tests (round-trip, hostile text); 3 -> Tasks 2 and 5 tests (odd shapes, offline/null status); 4 -> Task 5 tests (confirm, single-flight, unknown outcome); 5 -> Task 8 tests (no replay, sign-out clears drafts/flag).
