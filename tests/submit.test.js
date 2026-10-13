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
  assert.deepEqual(calls, [['upload', 'foto.jpg', 0], ['upload', 'nueva.pdf', 900], ['save', 42, { files_filemanager: 900, onlinetext_editor: { text: '', format: 1, itemid: 0 } }]]);
});

test('removing every file saves an empty draft area', async () => {
  const { api, calls } = fakeApi();
  await performSubmission({ api, write, assignment: assignment(), input: input({ files: { changed: true, keep: [], added: [] } }) });
  assert.deepEqual(calls, [['draftid'], ['save', 42, { files_filemanager: 555, onlinetext_editor: { text: '', format: 1, itemid: 0 } }]]);
});

test('a kept file that cannot be re-fetched aborts before anything is saved', async () => {
  const { api, calls } = fakeApi();
  const fetchImpl = async () => ({ ok: false, blob: async () => new Blob([]) });
  await assert.rejects(
    () => performSubmission({ api, write, fetchImpl, assignment: assignment(), input: input({ text: 'x', textChanged: true, files: { changed: true, keep: [{ name: 'foto.jpg', url: FURL }], added: [] } }) }),
    (e) => e.code === 'keepfailed',
  );
  assert.ok(!calls.some((c) => c[0] === 'save'));
  const thrown = async () => { throw new TypeError('offline'); };
  await assert.rejects(
    () => performSubmission({ api, write, fetchImpl: thrown, assignment: assignment(), input: input({ files: { changed: true, keep: [{ name: 'foto.jpg', url: FURL }], added: [] } }) }),
    (e) => e.code === 'keepfailed',
  );
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

test('a network error during save is an unconfirmed outcome and nothing else runs', async () => {
  const { api, calls } = fakeApi({ saveSubmission: async () => { throw new MoodleError('network'); } });
  await assert.rejects(() => performSubmission({ api, write, assignment: assignment(), input: input({ submit: true, text: 'a', textChanged: true }) }), (e) => e.code === 'unconfirmed');
  assert.ok(!calls.some((c) => c[0] === 'submit'));
});

test('a files-only change still sends the unchanged typed answer so Moodle never sees a missing editor', async () => {
  const { api, calls } = fakeApi();
  await performSubmission({
    api, write, assignment: assignment(),
    input: input({ files: { changed: true, keep: [], added: [fileObj('x.txt')] }, existing: { plain: 'mi respuesta', simple: true } }),
  });
  const save = calls.find((c) => c[0] === 'save');
  assert.deepEqual(save[2].onlinetext_editor, { text: '<p>mi respuesta</p>', format: 1, itemid: 0 });
  assert.ok('files_filemanager' in save[2]);
});

test('no typed-answer companion when the assignment has no online text; text-only still never sends files', async () => {
  const a = fakeApi();
  await performSubmission({ api: a.api, write, assignment: assignment({ plugins: { onlinetext: false, file: true } }), input: input({ files: { changed: true, keep: [], added: [fileObj('x.txt')] } }) });
  assert.deepEqual(Object.keys(a.calls.find((c) => c[0] === 'save')[2]), ['files_filemanager']);
  const b = fakeApi();
  await performSubmission({ api: b.api, write, assignment: assignment(), input: input({ text: 'hola', textChanged: true }) });
  assert.deepEqual(Object.keys(b.calls.find((c) => c[0] === 'save')[2]), ['onlinetext_editor']);
});

test('changing files while the existing answer has website formatting is refused before anything is written', async () => {
  const { api, calls } = fakeApi();
  await assert.rejects(
    () => performSubmission({ api, write, assignment: assignment(), input: input({ files: { changed: true, keep: [], added: [fileObj('x.txt')] }, existing: { plain: 'hola mundo', simple: false } }) }),
    (e) => e.code === 'formattedblocksfiles',
  );
  assert.deepEqual(calls, []);
});

test('an unconfirmed outcome: badresponse after the save/submit was sent; pre-write network errors stay plain', async () => {
  const a = fakeApi({ submitForGrading: async () => { throw new MoodleError('badresponse'); } });
  await assert.rejects(() => performSubmission({ api: a.api, write, assignment: assignment(), input: input({ submit: true, text: 'a', textChanged: true }) }), (e) => e.code === 'unconfirmed');
  assert.ok(a.calls.some((c) => c[0] === 'save')); // the save did go out
  const b = fakeApi({ uploadDraftFile: async () => { throw new MoodleError('network'); } });
  await assert.rejects(() => performSubmission({ api: b.api, write, assignment: assignment(), input: input({ files: { changed: true, keep: [], added: [fileObj('x.txt')] } }) }), (e) => e.code === 'network');
  const c = fakeApi({ saveSubmission: async () => { throw new MoodleError('submissionclosed', 'Closed'); } });
  await assert.rejects(() => performSubmission({ api: c.api, write, assignment: assignment(), input: input({ text: 'a', textChanged: true }) }), (e) => e.code === 'submissionclosed');
});

test('removing all files aborts when no draft area can be obtained (it would silently keep the files)', async () => {
  const { api, calls } = fakeApi({ getUnusedDraftItemId: async () => { throw new MoodleError('accessexception'); } });
  await assert.rejects(
    () => performSubmission({ api, write, assignment: assignment(), input: input({ files: { changed: true, keep: [], added: [] } }) }),
    (e) => e.code === 'nodraft',
  );
  assert.ok(!calls.some((c) => c[0] === 'save'));
});
