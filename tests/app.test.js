import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
  sampleCourses, sampleSections, sampleAssignmentsResponse, sampleStatusResponse,
  sampleQuizzesResponse, sampleQuizAccess, sampleQtypes, sampleAttemptAccess, sampleNoAttempts, sampleBest, sampleAttemptPage, mcqHtml,
} from './fixtures.js';
import { MoodleError } from '../src/api.js';
import { createMemoryStorage } from '../src/storage.js';

const { createApp } = await import('../src/app.js');
const { createAuth } = await import('../src/auth.js');
const { createCache } = await import('../src/store.js');
const { createVault, createMemoryKeyStore } = await import('../src/vault.js');
const { createDrafts } = await import('../src/drafts.js');
const { createAttemptStore } = await import('../src/attemptstore.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(apiOverrides = {}, preloadSession = false) {
  const dom = setupDom();
  const storage = createMemoryStorage();
  const api = {
    requestToken: async () => 'tok',
    getSiteInfo: async () => ({ userid: 7, fullname: 'Ana' }),
    getCourses: async () => sampleCourses,
    getCourseContents: async () => sampleSections,
    getAssignments: async () => sampleAssignmentsResponse,
    getSubmissionStatus: async () => sampleStatusResponse,
    getUnusedDraftItemId: async () => ({ itemid: 555 }),
    saveSubmission: async () => [],
    submitForGrading: async () => [],
    uploadDraftFile: async (t, f) => ({ itemid: 900, filename: f.name }),
    deleteDraftFiles: async () => [],
    getQuizzes: async () => sampleQuizzesResponse,
    getQuizAccess: async () => sampleQuizAccess,
    getAttemptAccess: async () => sampleAttemptAccess,
    getQuizQtypes: async () => sampleQtypes,
    getUserAttempts: async () => sampleNoAttempts,
    getBestGrade: async () => sampleBest,
    startAttempt: async () => ({ attempt: { id: 77, state: 'inprogress', currentpage: 0 }, warnings: [] }),
    getAttemptData: async (t, id, page) => sampleAttemptPage(page, page === 0 ? 1 : -1),
    saveAttempt: async () => ({ status: true, warnings: [] }),
    processAttempt: async (t, id, data, o) => ({ state: o && o.finish ? 'finished' : 'inprogress', warnings: [] }),
    getAttemptSummary: async () => ({ questions: [{ slot: 1, state: 'complete' }, { slot: 2, state: 'todo' }] }),
    getAttemptReview: async () => ({ grade: '1.00', attempt: { id: 77 }, questions: [{ slot: 1, number: 1, type: 'multichoice', html: mcqHtml(5, 1) }], warnings: [] }),
    ...apiOverrides,
  };
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  const auth = createAuth({ storage, api, vault });
  const cache = createCache(storage);
  if (preloadSession) storage.setItem('aules.session', JSON.stringify({ token: 'tok', userid: 7, fullname: 'Ana' }));
  const root = document.getElementById('app');
  const drafts = createDrafts(storage);
  const attemptStore = createAttemptStore(storage);
  const app = createApp({ root, api, auth, cache, win: dom.window, drafts, attemptStore, nowFn: () => 1785000000, locale: 'en' });
  return { app, root, storage, auth, cache, vault, drafts, attemptStore, api, win: dom.window };
}

test('no session -> login screen', async () => {
  const { app, root } = setup();
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
});

test('login shows the course list', async () => {
  const { app, root, storage } = setup();
  await app.start();
  await app.login('10000001', 'x');
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(storage.getItem('aules.session'));
});

test('no stray "null"/"false" text is rendered when optional parts are absent', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  assert.ok(!/null|false|undefined/.test(root.textContent));
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.ok(!/null|false|undefined/.test(root.textContent));
});

test('failed login rejects (login form shows the message) and stays on login', async () => {
  const { app, root } = setup({ requestToken: async () => { throw new MoodleError('invalidlogin'); } });
  await app.start();
  await assert.rejects(() => app.login('u', 'p'));
  assert.ok(root.querySelector('form.login-card'));
});

test('opening a course renders its content and marks the shell as has-detail', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.ok(root.querySelector('.shell.has-detail'));
  assert.ok(root.querySelector('.pane-detail details'));
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Programació');
});

test('invalid token with nothing saved -> back to login with expiry message', async () => {
  const { app, root, storage } = setup({ getCourses: async () => { throw new MoodleError('invalidtoken'); } }, true);
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
  assert.match(root.querySelector('.form-msg').textContent, /session expired/i);
  assert.equal(storage.getItem('aules.session'), null);
});

test('offline with cached courses -> cards plus offline banner', async () => {
  const { app, root, cache } = setup({ getCourses: async () => { throw new MoodleError('network'); } }, true);
  cache.set('courses', sampleCourses);
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(root.querySelector('.banner'));
});

test('offline with nothing cached -> error message and retry', async () => {
  const { app, root } = setup({ getCourses: async () => { throw new MoodleError('network'); } }, true);
  await app.start();
  assert.match(root.textContent, /Cannot reach Aules/);
  assert.ok(root.querySelector('button.retry'));
});

test('course contents failing offline falls back to cached contents', async () => {
  const { app, root, cache, win } = setup({ getCourseContents: async () => { throw new MoodleError('network'); } }, true);
  cache.set('course:11', sampleSections);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.ok(root.querySelector('.pane-detail details'));
  assert.ok(root.querySelector('.pane-detail .banner'));
});

test('logout clears session, saved credentials and cached data and returns to login', async () => {
  const { app, root, storage, cache, vault } = setup({}, true);
  await vault.save('u', 'p');
  await app.start();
  assert.ok(cache.get('courses'));
  app.logout();
  await tick();
  assert.ok(root.querySelector('form.login-card'));
  assert.equal(storage.getItem('aules.session'), null);
  assert.equal(cache.get('courses'), null);
  assert.equal(await vault.load(), null);
});

test('expired token with saved credentials is renewed silently (no login screen)', async () => {
  let first = true;
  const tokens = [];
  const { app, root, vault, auth } = setup({
    getCourses: async (token) => {
      tokens.push(token);
      if (first) { first = false; throw new MoodleError('invalidtoken'); }
      return sampleCourses;
    },
    requestToken: async () => 'fresh-token',
  }, true);
  await vault.save('10000001', 'pw');
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.equal(root.querySelector('form.login-card'), null);
  assert.deepEqual(tokens, ['tok', 'fresh-token']);
  assert.equal(auth.getSession().token, 'fresh-token');
});

test('renewal is retried only once: a second invalidtoken ends at login', async () => {
  let calls = 0;
  const { app, root, vault } = setup({
    getCourses: async () => { calls += 1; throw new MoodleError('invalidtoken'); },
  }, true);
  await vault.save('u', 'pw');
  await app.start();
  assert.equal(calls, 2);
  assert.ok(root.querySelector('form.login-card'));
});

test('saved password rejected -> login screen and credentials wiped', async () => {
  const { app, root, vault } = setup({
    getCourses: async () => { throw new MoodleError('invalidtoken'); },
    requestToken: async () => { throw new MoodleError('invalidlogin'); },
  }, true);
  await vault.save('u', 'old');
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
  assert.equal(await vault.load(), null);
});

test('renewal blocked only by the network keeps credentials and shows cached data', async () => {
  const { app, root, vault, cache } = setup({
    getCourses: async () => { throw new MoodleError('invalidtoken'); },
    requestToken: async () => { throw new MoodleError('network'); },
  }, true);
  await vault.save('u', 'pw');
  cache.set('courses', sampleCourses);
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(root.querySelector('.banner'));
  assert.deepEqual(await vault.load(), { username: 'u', password: 'pw' });
});

test('sign out while courses are loading does not re-create cache or session', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { app, cache, auth, root } = setup({ getCourses: async () => { await gate; return sampleCourses; } }, true);
  const started = app.start();
  await tick();
  app.logout();
  release();
  await started;
  await tick();
  assert.equal(cache.get('courses'), null);
  assert.equal(auth.getSession(), null);
  assert.ok(root.querySelector('form.login-card'));
});

test('sign out while a silent renewal is in flight stays signed out', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { app, auth, vault, root, cache } = setup({
    getCourses: async () => { throw new MoodleError('invalidtoken'); },
    requestToken: async () => { await gate; return 'new'; },
  }, true);
  await vault.save('u', 'p');
  const started = app.start();
  await tick(); await tick();
  app.logout();
  release();
  await started;
  await tick();
  assert.equal(auth.getSession(), null);
  assert.equal(cache.get('courses'), null);
  assert.ok(root.querySelector('form.login-card'));
});

const timelineCourses = [
  { id: 11, fullname: 'Gramática', shortname: 'G', coursecategory: 'Español A1', progress: 10 },
  { id: 12, fullname: 'Cultura', shortname: 'C', coursecategory: 'Español B1', progress: null },
];

test('categories from the timeline render as folders', async () => {
  const { app, root } = setup({ getCoursesByTimeline: async () => ({ courses: timelineCourses }) }, true);
  await app.start();
  assert.equal(root.querySelectorAll('details.folder').length, 2);
  assert.equal(root.querySelectorAll('a.card').length, 2);
});

test('the header links to Diagnostics and the route shows the report without leaking the token', async () => {
  const { app, root, win } = setup({
    getCoursesByTimeline: async () => ({ courses: timelineCourses }),
    getSiteInfo: async () => ({ release: '4.1', functions: [{ name: 'mod_assign_save_submission' }], usermaxuploadfilesize: 1000 }),
    getCourseContents: async () => [{ id: 1, modules: [{ modname: 'assign', name: 'secret', contents: [{ fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/x?token=tok' }] }] }],
  }, true);
  await app.start();
  assert.ok(root.querySelector('.pane-list a.link[href="#/diagnostics"]'));
  win.location.hash = '#/diagnostics';
  await app.showRoute();
  await tick(); await tick(); await tick();
  assert.ok(root.querySelector('.shell.has-detail'));
  const report = root.querySelector('pre.report').textContent;
  assert.match(report, /Aules diagnostics/);
  assert.match(report, /Category source: 1/);
  assert.match(report, /mod_assign_save_submission: yes/);
  assert.match(report, /assign x2/);
  assert.ok(!/tok\b|secret|Gramática/.test(report));
});

test('course page gets the course progress from the list', async () => {
  const { app, root, win } = setup({ getCoursesByTimeline: async () => ({ courses: timelineCourses }) }, true);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.equal(root.querySelector('progress.course-progress').value, 10);
});

test('invalid token during diagnostics with nothing saved returns to login', async () => {
  const { app, root, win } = setup({
    getCoursesByTimeline: async () => ({ courses: timelineCourses }),
    getSiteInfo: async () => { throw new MoodleError('invalidtoken'); },
  }, true);
  await app.start();
  win.location.hash = '#/diagnostics';
  await app.showRoute();
  await tick(); await tick(); await tick();
  assert.ok(root.querySelector('form.login-card'));
});

const goAssign = async (app, win) => { win.location.hash = '#/course/11/assign/9'; await app.showRoute(); await tick(); await tick(); };
const clickBtn = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text).click();
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };

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
  clickBtn(root, 'Save draft');
  await settle();
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
  root.querySelector('textarea').value = 'Texto final';
  clickBtn(root, 'Submit for grading');
  assert.deepEqual(seq, []);
  clickBtn(root, 'Yes, submit');
  await settle();
  assert.deepEqual(seq, ['save', 'submit']);
  assert.match(root.querySelector('.flash').textContent, /Submitted/);
});

test('a network failure during a write refreshes the screen and says it could not confirm', async () => {
  const { app, root, win } = setup({ saveSubmission: async () => { throw new MoodleError('network'); } }, true);
  await app.start();
  await goAssign(app, win);
  root.querySelector('textarea').value = 'x y z';
  clickBtn(root, 'Save draft');
  await settle();
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
  root.querySelector('textarea').value = 'algo';
  clickBtn(root, 'Save draft');
  await settle();
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
  await settle();
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
  await settle();
  ok.root.querySelector('button.upload-test').click();
  await settle();
  assert.match(ok.root.querySelector('pre.report').textContent, /Upload test: ok$/);
  assert.equal(ok.cache.get('uploadOk').data, true);
  assert.equal(deleted.length, 1);

  const bad = setup({ uploadDraftFile: async () => { throw new MoodleError('nopermissions'); } }, true);
  await bad.app.start();
  bad.win.location.hash = '#/diagnostics';
  await bad.app.showRoute();
  await settle();
  bad.root.querySelector('button.upload-test').click();
  await settle();
  assert.match(bad.root.querySelector('pre.report').textContent, /Upload test: nopermissions$/);
  assert.equal(bad.cache.get('uploadOk').data, false);
  await goAssign(bad.app, bad.win);
  assert.equal(bad.root.querySelector('input[type=file]'), null);
  assert.match(bad.root.querySelector('.pane-detail').textContent, /not available for your account/);
});

const { draftBase, parseStatus: parseStatusForTest } = await import('../src/assign.js');
const BASE = draftBase(parseStatusForTest(sampleStatusResponse));
const setFilesOn = (input, files) => { Object.defineProperty(input, 'files', { value: files, configurable: true }); input.dispatchEvent(new window.Event('change')); };

test('a local draft typed against the same server text is restored automatically', async () => {
  const { app, root, win, drafts } = setup({}, true);
  drafts.set(42, 'mi borrador', BASE);
  await app.start();
  await goAssign(app, win);
  assert.equal(root.querySelector('.pane-detail textarea').value, 'mi borrador');
  assert.equal(root.querySelector('.stale-draft'), null);
});

test('a local draft typed against different server text is offered, not applied', async () => {
  const { app, root, win, drafts } = setup({}, true);
  drafts.set(42, 'texto viejo', 'otra base');
  await app.start();
  await goAssign(app, win);
  assert.equal(root.querySelector('.pane-detail textarea').value, 'Mi ciudad es bonita.');
  assert.ok(root.querySelector('.stale-draft'));
  clickBtn(root, 'Discard');
  assert.equal(drafts.get(42), null);
});

test('typing stores the draft together with the server text it is based on', async () => {
  const { app, root, win, drafts } = setup({}, true);
  await app.start();
  await goAssign(app, win);
  const ta = root.querySelector('textarea');
  ta.value = 'nuevo';
  ta.dispatchEvent(new window.Event('input'));
  assert.equal(drafts.get(42).base, BASE);
});

test('file upload stays hidden until the Test upload has succeeded', async () => {
  const { app, root, win, cache } = setup({}, true);
  await app.start();
  await goAssign(app, win);
  assert.equal(root.querySelector('input[type=file]'), null);
  assert.match(root.querySelector('.pane-detail').textContent, /Test upload/);
  cache.set('uploadOk', true);
  await goAssign(app, win);
  assert.ok(root.querySelector('input[type=file]'));
});

test('a result that arrives after sign-out is dropped: no flash for the next session and no further write steps', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const calls = [];
  const { app, root, win, cache } = setup({
    uploadDraftFile: async (t, f) => { calls.push('upload'); await gate; return { itemid: 900, filename: f.name }; },
    saveSubmission: async () => { calls.push('save'); return []; },
  }, true);
  cache.set('uploadOk', true);
  await app.start();
  await goAssign(app, win);
  setFilesOn(root.querySelector('input[type=file]'), [new window.File(['abc'], 'a.pdf')]);
  clickBtn(root, 'Save draft');
  await tick();
  app.logout();
  release();
  await settle();
  assert.deepEqual(calls, ['upload']); // the save step was refused after sign-out
  await app.login('u', 'p');
  await goAssign(app, win);
  assert.equal(root.querySelector('.flash'), null);
});

test('the saved/unconfirmed flash is only shown for the assignment that was saved, not elsewhere', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { app, root, win } = setup({ saveSubmission: async () => { await gate; return []; } }, true);
  await app.start();
  await goAssign(app, win);
  root.querySelector('textarea').value = 'cambio';
  clickBtn(root, 'Save draft');
  await tick();
  win.location.hash = '#/course/11';
  await app.showRoute();
  await settle();
  release();
  await settle();
  assert.equal(root.querySelector('.flash'), null); // not painted on the course page
  await goAssign(app, win);
  assert.equal(root.querySelector('.flash'), null); // and not carried to a later visit
});

test('Test upload: an expired session does not mark uploads as unavailable, and a result after sign-out is not stored', async () => {
  const a = setup({ uploadDraftFile: async () => { throw new MoodleError('invalidtoken'); } }, true);
  await a.app.start();
  a.win.location.hash = '#/diagnostics';
  await a.app.showRoute();
  await settle();
  a.root.querySelector('button.upload-test').click();
  await settle();
  assert.equal(a.cache.get('uploadOk'), null);

  let release; const gate = new Promise((r) => { release = r; });
  const b = setup({ uploadDraftFile: async (t, f) => { await gate; return { itemid: 1, filename: f.name }; } }, true);
  await b.app.start();
  b.win.location.hash = '#/diagnostics';
  await b.app.showRoute();
  await settle();
  b.root.querySelector('button.upload-test').click();
  await tick();
  b.app.logout();
  release();
  await settle();
  assert.equal(b.cache.get('uploadOk'), null);
});

// ---------- performance: parallel requests, saved data first, no heavy call on the critical path ----------
const gateOf = () => { let release; const promise = new Promise((r) => { release = r; }); return [promise, release]; };
const rawStatus42 = sampleStatusResponse;
const assigns11 = () => sampleAssignmentsResponse.courses[0].assignments;

test('Exercise page: with the assignment cached, the status request starts at once instead of waiting for the list', async () => {
  const [listGate, releaseList] = gateOf();
  let statusCalls = 0;
  const { app, win, cache } = setup({
    getAssignments: async () => { await listGate; return sampleAssignmentsResponse; },
    getSubmissionStatus: async () => { statusCalls += 1; return rawStatus42; },
  }, true);
  cache.set('assigns:11', assigns11());
  await app.start();
  win.location.hash = '#/course/11/assign/9';
  await tick(); await tick();
  assert.equal(statusCalls, 1); // already asked, while the assignments list is still pending
  releaseList();
  await settle();
});

test('Exercise page: cached instructions show immediately, the form stays locked until the fresh status arrives', async () => {
  const [gate, release] = gateOf();
  const { app, root, win, cache } = setup({
    getAssignments: async () => { await gate; return sampleAssignmentsResponse; },
    getSubmissionStatus: async () => { await gate; return rawStatus42; },
  }, true);
  cache.set('assigns:11', assigns11());
  cache.set('status:42', rawStatus42);
  await app.start();
  win.location.hash = '#/course/11/assign/9';
  await tick(); await tick();
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Tarea 1');
  assert.match(root.querySelector('.pane-detail').textContent, /Escribe un párrafo/);
  assert.equal(root.querySelector('.pane-detail form'), null); // locked while verifying
  assert.match(root.querySelector('.pane-detail .note').textContent, /Checking for changes/);
  assert.match(root.querySelector('.pane-detail').textContent, /Mi ciudad es bonita/); // last known answer is visible
  release();
  await settle();
  assert.ok(root.querySelector('.pane-detail form'));
  assert.equal(root.querySelector('.pane-detail textarea').value, 'Mi ciudad es bonita.');
});

test('Exercise page: the fresh status is cached for next time and a slow site-info call never blocks the form', async () => {
  const [siteGate, releaseSite] = gateOf();
  let siteCalls = 0;
  const { app, root, win, cache } = setup({
    getSiteInfo: async () => { siteCalls += 1; await siteGate; return { usermaxuploadfilesize: 5000000 }; },
  }, true);
  cache.set('uploadOk', true);
  await app.start();
  await goAssign(app, win);
  assert.ok(root.querySelector('.pane-detail form')); // rendered although getSiteInfo is still pending
  assert.ok(root.querySelector('input[type=file]'));
  assert.equal(siteCalls, 1);
  assert.ok(cache.get('status:42'));
  releaseSite();
  await settle();
  assert.equal(cache.get('siteMax').data, 5000000);
  await goAssign(app, win);
  assert.equal(siteCalls, 1); // remembered for a day, not asked again
});

test('after saving, the screen is not painted from the now-outdated cached status', async () => {
  const [gate, release] = gateOf();
  let statusCalls = 0;
  const { app, root, win } = setup({
    getSubmissionStatus: async () => { statusCalls += 1; if (statusCalls > 1) await gate; return rawStatus42; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/assign/9'; // navigate like a user: one load, which fills the saved copy
  await settle();
  root.querySelector('textarea').value = 'cambio';
  clickBtn(root, 'Save draft');
  await tick(); await tick(); await tick();
  // the second status request is pending; the old saved status must not be shown meanwhile
  assert.equal(statusCalls, 2);
  assert.equal(root.querySelector('.pane-detail .assign'), null);
  assert.ok(root.querySelector('.pane-detail .status'));
  release();
  await settle();
  assert.match(root.querySelector('.flash').textContent, /Draft saved/);
});

test('Course page: contents and due dates are requested together, and cached content shows at once', async () => {
  const [gate, release] = gateOf();
  const started = [];
  const { app, root, win, cache } = setup({
    getCourseContents: async () => { started.push('contents'); await gate; return sampleSections; },
    getAssignments: async () => { started.push('assignments'); await gate; return sampleAssignmentsResponse; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11';
  await tick(); await tick();
  assert.deepEqual(started.sort(), ['assignments', 'contents']); // both in flight, neither waited for the other
  release();
  await settle();
  assert.ok(root.querySelector('.pane-detail details.unit'));

  // second visit: cached content is on screen before the network answers
  const [gate2, release2] = gateOf();
  const b = setup({
    getCourseContents: async () => { await gate2; return sampleSections; },
    getAssignments: async () => { await gate2; return sampleAssignmentsResponse; },
  }, true);
  b.cache.set('course:11', sampleSections);
  b.cache.set('assigns:11', assigns11());
  await b.app.start();
  b.win.location.hash = '#/course/11';
  await tick(); await tick();
  assert.ok(b.root.querySelector('.pane-detail details.unit'));
  assert.ok(b.root.querySelector('.pane-detail .refreshing'));
  assert.ok(b.root.querySelector('a.assign-link'));
  release2();
  await settle();
  assert.equal(b.root.querySelector('.pane-detail .refreshing'), null);
});

test('Course page: when the fresh content differs from the saved copy, the screen updates', async () => {
  const [gate, release] = gateOf();
  const changed = [{ ...sampleSections[0], name: 'Introducción nueva' }, sampleSections[1]];
  const { app, root, win, cache } = setup({
    getCourseContents: async () => { await gate; return changed; },
  }, true);
  cache.set('course:11', sampleSections);
  await app.start();
  win.location.hash = '#/course/11';
  await tick(); await tick();
  assert.ok(!/Introducción nueva/.test(root.querySelector('.pane-detail').textContent));
  release();
  await settle();
  assert.match(root.querySelector('.pane-detail').textContent, /Introducción nueva/);
});

test('Course page: with saved content and a failing network it stays on screen with the offline note', async () => {
  const { app, root, win, cache } = setup({ getCourseContents: async () => { throw new MoodleError('network'); } }, true);
  cache.set('course:11', sampleSections);
  await app.start();
  win.location.hash = '#/course/11';
  await settle();
  assert.ok(root.querySelector('.pane-detail details.unit'));
  assert.ok(root.querySelector('.pane-detail .banner'));
  assert.equal(root.querySelector('.pane-detail .refreshing'), null);
});

test('App launch: saved courses appear immediately and are refreshed in the background', async () => {
  const [gate, release] = gateOf();
  const { app, root, cache } = setup({
    getCoursesByTimeline: async () => { await gate; return { courses: [
      { id: 11, fullname: 'Programació', shortname: 'PRG', coursecategory: '' },
      { id: 12, fullname: 'Sistemes', shortname: 'SI', coursecategory: '' },
      { id: 13, fullname: 'Nuevo curso', shortname: 'NC', coursecategory: '' },
    ] }; },
  }, true);
  cache.set('courses', sampleCourses);
  const started = app.start();
  await tick(); await tick();
  assert.equal(root.querySelectorAll('a.card').length, 2); // from the saved copy, network still pending
  release();
  await started;
  assert.equal(root.querySelectorAll('a.card').length, 3);
  assert.equal(cache.get('courses').data.length, 3);
});

test('App launch: an expired token while refreshing in the background still signs out cleanly', async () => {
  const { app, root, cache } = setup({ getCoursesByTimeline: async () => { throw new MoodleError('invalidtoken'); }, getCourses: async () => { throw new MoodleError('invalidtoken'); } }, true);
  cache.set('courses', sampleCourses);
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
});

test('several requests hitting an expired token share one silent renewal instead of logging in once each', async () => {
  let tokenRequests = 0;
  let expired = true;
  const { app, root, win, vault } = setup({
    requestToken: async () => { tokenRequests += 1; expired = false; return 'fresh'; },
    getCourseContents: async (token) => { if (expired && token === 'tok') throw new MoodleError('invalidtoken'); return sampleSections; },
    getAssignments: async (token) => { if (expired && token === 'tok') throw new MoodleError('invalidtoken'); return sampleAssignmentsResponse; },
    getCourses: async () => sampleCourses,
  }, true);
  await vault.save('u', 'pw');
  await app.start();
  tokenRequests = 0;
  win.location.hash = '#/course/11';
  await settle();
  assert.equal(tokenRequests, 1);
  assert.ok(root.querySelector('.pane-detail details.unit'));
});

test('Diagnostics lists the slowest API calls of this session', async () => {
  const { createTimings } = await import('../src/timings.js');
  const timings = createTimings();
  const dom = setupDom();
  const storage = createMemoryStorage();
  const base = {
    requestToken: async () => 'tok', getSiteInfo: async () => ({ userid: 7 }), getCourses: async () => sampleCourses,
    getCourseContents: async () => sampleSections, getAssignments: async () => sampleAssignmentsResponse,
  };
  const api = timings.wrap(base);
  const app = createApp({
    root: document.getElementById('app'), api, auth: createAuth({ storage, api: base }), cache: createCache(storage), win: dom.window, timings,
  });
  storage.setItem('aules.session', JSON.stringify({ token: 'tok', userid: 7, fullname: 'Ana' }));
  await app.start();
  dom.window.location.hash = '#/diagnostics';
  await app.showRoute();
  await settle();
  assert.match(document.querySelector('pre.report').textContent, /Call timings \(slowest first\):\n  \w+: \d+ ms/);
});

test('after a successful save, if the status reload fails the screen never shows the outdated answer under "Draft saved."', async () => {
  let statusCalls = 0;
  const { app, root, win } = setup({
    getSubmissionStatus: async () => { statusCalls += 1; if (statusCalls > 1) throw new MoodleError('network'); return rawStatus42; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/assign/9';
  await settle();
  root.querySelector('textarea').value = 'respuesta nueva';
  clickBtn(root, 'Save draft');
  await settle();
  const pane = root.querySelector('.pane-detail');
  assert.match(pane.querySelector('.flash').textContent, /Draft saved/);
  assert.ok(!pane.textContent.includes('Mi ciudad es bonita')); // the pre-save answer is not shown as current
  assert.match(pane.textContent, /offline/i);
});

test('an unconfirmed write also discards the saved status so it cannot be mistaken for current', async () => {
  let statusCalls = 0;
  const { app, root, win, cache } = setup({
    getSubmissionStatus: async () => { statusCalls += 1; if (statusCalls > 1) throw new MoodleError('network'); return rawStatus42; },
    saveSubmission: async () => { throw new MoodleError('network'); },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/assign/9';
  await settle();
  root.querySelector('textarea').value = 'respuesta nueva';
  clickBtn(root, 'Save draft');
  await settle();
  assert.equal(cache.get('status:42'), null);
  assert.match(root.querySelector('.pane-detail .flash').textContent, /Could not confirm/);
});

// ---------- quizzes ----------
const goQuiz = async (win, hash = '#/course/11/quiz/10') => { win.location.hash = hash; await settle(); };
const quizClick = (root, text) => [...root.querySelectorAll('.pane-detail button')].find((b) => b.textContent === text).click();
const hasButton = (root, text) => [...root.querySelectorAll('.pane-detail button')].some((b) => b.textContent === text);

test('the course page links the quiz', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11';
  await settle();
  const link = root.querySelector('a.quiz-link');
  assert.ok(link);
  assert.equal(link.getAttribute('href'), '#/course/11/quiz/10');
});

test('the quiz screen shows the saved quiz at once but offers Start only after the fresh checks', async () => {
  const [gate, release] = gateOf();
  const { app, root, win, cache } = setup({ getQuizQtypes: async () => { await gate; return sampleQtypes; } }, true);
  cache.set('quizzes:11', sampleQuizzesResponse.quizzes);
  await app.start();
  win.location.hash = '#/course/11/quiz/10';
  await tick(); await tick();
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Test 1'); // from the saved copy
  assert.equal(hasButton(root, 'Start attempt'), false); // but no Start yet
  assert.match(root.querySelector('.pane-detail').textContent, /Checking this quiz/);
  release();
  await settle();
  assert.equal(hasButton(root, 'Start attempt'), true);
});

test('an unsupported quiz never offers Start', async () => {
  const { app, root, win } = setup({ getQuizQtypes: async () => ({ questiontypes: ['multichoice', 'ddwtos'] }) }, true);
  await app.start();
  await goQuiz(win);
  assert.equal(hasButton(root, 'Start attempt'), false);
  assert.match(root.querySelector('.pane-detail').textContent, /ddwtos/);
  assert.ok(root.querySelector('.pane-detail a[href*="mod/quiz/view.php?id=10"]'));
});

test('a failed check (unknown) never offers Start', async () => {
  const { app, root, win } = setup({ getQuizAccess: async () => { throw new MoodleError('accessexception'); } }, true);
  await app.start();
  await goQuiz(win);
  assert.equal(hasButton(root, 'Start attempt'), false);
  assert.match(root.querySelector('.pane-detail').textContent, /Could not check/);
});

test('Start asks for confirmation, starts once, and opens the attempt', async () => {
  let starts = 0;
  const { app, root, win } = setup({ startAttempt: async () => { starts += 1; return { attempt: { id: 77, currentpage: 0 }, warnings: [] }; } }, true);
  await app.start();
  await goQuiz(win);
  quizClick(root, 'Start attempt');
  assert.equal(starts, 0);
  quizClick(root, 'Yes, start');
  await settle();
  assert.equal(starts, 1);
  assert.equal(win.location.hash, '#/course/11/quiz/10/attempt/77');
  assert.ok(root.querySelector('.pane-detail input[name="q5:1_answer"]'));
});

test('an unconfirmed start reloads the quiz and offers Continue for the attempt that now exists', async () => {
  let attempts = { attempts: [] };
  const { app, root, win } = setup({
    startAttempt: async () => { attempts = { attempts: [{ id: 77, attempt: 1, state: 'inprogress', currentpage: 0 }] }; throw new MoodleError('network'); },
    getUserAttempts: async () => attempts,
  }, true);
  await app.start();
  await goQuiz(win);
  quizClick(root, 'Start attempt');
  quizClick(root, 'Yes, start');
  await settle();
  assert.match(root.querySelector('.pane-detail .flash').textContent, /Could not confirm/);
  assert.equal(root.querySelector('.pane-detail a.btn').getAttribute('href'), '#/course/11/quiz/10/attempt/77');
});

test('an in-progress attempt shows Continue, and the attempt opens on its saved page', async () => {
  const inprog = { attempts: [{ id: 77, attempt: 1, state: 'inprogress', currentpage: 1 }] };
  const { app, root, win } = setup({ getUserAttempts: async () => inprog }, true);
  await app.start();
  await goQuiz(win);
  assert.equal(root.querySelector('.pane-detail a.btn').getAttribute('href'), '#/course/11/quiz/10/attempt/77');
  win.location.hash = '#/course/11/quiz/10/attempt/77';
  await settle();
  assert.ok(root.querySelector('.pane-detail input[name="q6:2_answer"]')); // page 1 = the true/false question
});

test('Next sends the page answers with process_attempt (no finish) and moves to the next page; unsent local answers survive', async () => {
  const sent = [];
  const { app, root, win, attemptStore } = setup({ processAttempt: async (t, id, data, o) => { sent.push([data, o]); return { state: 'inprogress', warnings: [] }; } }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  const radio = root.querySelector('.pane-detail input[name="q5:1_answer"][value="1"]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(attemptStore.get(77, 0));
  quizClick(root, 'Next');
  await settle();
  assert.equal(sent.length, 1);
  assert.ok(sent[0][0].some((a) => a.name === 'q5:1_answer' && a.value === '1'));
  assert.equal(!!sent[0][1].finish, false);
  assert.equal(win.location.hash, '#/course/11/quiz/10/attempt/77/1');
  assert.ok(root.querySelector('.pane-detail input[name="q6:2_answer"]'));
});

test('Finish shows the summary, needs a confirm, finishes once, clears local answers and returns to the quiz with a flash', async () => {
  let finishes = 0;
  const { app, root, win, attemptStore } = setup({
    processAttempt: async (t, id, data, o) => { if (o && o.finish) finishes += 1; return { state: o && o.finish ? 'finished' : 'inprogress', warnings: [] }; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/1';
  await settle();
  const r = root.querySelector('.pane-detail input[name="q6:2_answer"][value="1"]');
  r.checked = true;
  r.dispatchEvent(new window.Event('change', { bubbles: true }));
  quizClick(root, 'Finish attempt');
  await settle();
  assert.match(root.querySelector('.pane-detail .confirm').textContent, /answered 1 of 2/);
  assert.equal(finishes, 0);
  quizClick(root, 'Yes, submit');
  await settle();
  assert.equal(finishes, 1);
  assert.equal(attemptStore.get(77, 1), null);
  assert.equal(win.location.hash, '#/course/11/quiz/10');
  assert.match(root.querySelector('.pane-detail .flash').textContent, /Attempt finished/);
});

test('an expired token during a quiz write renews the session but does not replay the write', async () => {
  let saves = 0;
  const { app, root, win, vault } = setup({
    saveAttempt: async () => { saves += 1; throw new MoodleError('invalidtoken'); },
    requestToken: async () => 'fresh',
  }, true);
  await vault.save('u', 'pw');
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  quizClick(root, 'Save');
  await settle();
  assert.equal(saves, 1);
  assert.match(root.querySelector('.pane-detail .form-msg').textContent, /tap again/);
});

test('a network failure while saving a page is an unconfirmed outcome that reloads the quiz', async () => {
  const { app, root, win } = setup({ saveAttempt: async () => { throw new MoodleError('network'); } }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  quizClick(root, 'Save');
  await settle();
  assert.equal(win.location.hash, '#/course/11/quiz/10');
  assert.match(root.querySelector('.pane-detail .flash').textContent, /Could not confirm/);
});

test('sign-out during a quiz write drops the result, clears local answers and leaves no flash for the next session', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { app, root, win, attemptStore } = setup({ processAttempt: async (t, id, data, o) => { await gate; return { state: o && o.finish ? 'finished' : 'inprogress', warnings: [] }; } }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  const radio = root.querySelector('.pane-detail input[name="q5:1_answer"][value="0"]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  quizClick(root, 'Next');
  await tick();
  app.logout();
  release();
  await settle();
  assert.equal(attemptStore.get(77, 0), null);
  await app.login('u', 'p');
  win.location.hash = '#/course/11/quiz/10';
  await settle();
  assert.equal(root.querySelector('.pane-detail .flash'), null);
});

test('an attempt containing an unsupported question type shows no controls', async () => {
  const { app, root, win } = setup({ getAttemptData: async () => ({ attempt: { id: 77 }, nextpage: -1, questions: [{ slot: 1, number: 1, type: 'ddwtos', html: '<div class="que ddwtos"></div>' }], warnings: [] }) }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  assert.match(root.querySelector('.pane-detail').textContent, /cannot show/);
  assert.equal(root.querySelector('.pane-detail input'), null);
});

test('the review screen shows the finished attempt read-only', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/review/77';
  await settle();
  assert.match(root.querySelector('.pane-detail').textContent, /Grade: 1\.00/);
  assert.ok([...root.querySelectorAll('.pane-detail input:not([type=hidden])')].every((i) => i.hasAttribute('disabled')));
});

test('a quiz that is not in the course shows a not-found message', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  await goQuiz(win, '#/course/11/quiz/999');
  assert.match(root.querySelector('.pane-detail').textContent, /not found/);
});

test('offline with a saved quiz shows it read-only with no attempt actions', async () => {
  const { app, root, win, cache } = setup({ getQuizzes: async () => { throw new MoodleError('network'); } }, true);
  cache.set('quizzes:11', sampleQuizzesResponse.quizzes);
  await app.start();
  await goQuiz(win);
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Test 1');
  assert.equal(hasButton(root, 'Start attempt'), false);
  assert.match(root.querySelector('.pane-detail').textContent, /offline/i);
});

// ---------- quiz review fixes ----------
const serverChecks = (v) => mcqHtml(5, 1).replace(`value="${v}" id="q5:1_answer${v}"`, `value="${v}" id="q5:1_answer${v}" checked`);

test('after a page is saved the local copy is dropped, so answers changed elsewhere are not overridden', async () => {
  let serverAnswer = 0;
  const { app, root, win } = setup({
    getAttemptData: async (t, id, page) => (page === 0
      ? { ...sampleAttemptPage(0, 1), questions: [{ slot: 1, number: 1, type: 'multichoice', html: serverChecks(serverAnswer) }] }
      : sampleAttemptPage(1, -1)),
  }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  const r1 = root.querySelector('.pane-detail input[name="q5:1_answer"][value="1"]');
  r1.checked = true;
  r1.dispatchEvent(new window.Event('change', { bubbles: true }));
  quizClick(root, 'Next');
  await settle();
  serverAnswer = 2; // the answer was changed from another device meanwhile
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  assert.equal(root.querySelector('.pane-detail input[name="q5:1_answer"][value="2"]').checked, true);
  assert.equal(root.querySelector('.pane-detail input[name="q5:1_answer"][value="1"]').checked, false);
});

test('answers that were typed but never sent survive leaving the page and coming back', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  const r1 = root.querySelector('.pane-detail input[name="q5:1_answer"][value="1"]');
  r1.checked = true;
  r1.dispatchEvent(new window.Event('change', { bubbles: true }));
  win.location.hash = '#/course/11/quiz/10/attempt/77/1';
  await settle();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  assert.equal(root.querySelector('.pane-detail input[name="q5:1_answer"][value="1"]').checked, true);
});

test('leaving the attempt while a page change is in flight does not pull the user back', async () => {
  const [gate, release] = gateOf();
  const { app, root, win } = setup({ processAttempt: async () => { await gate; return { state: 'inprogress', warnings: [] }; } }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  quizClick(root, 'Next');
  await tick();
  win.location.hash = '#/course/11';
  await settle();
  release();
  await settle();
  assert.equal(win.location.hash, '#/course/11');
});

test('finishing while the user is already back on the quiz screen refreshes it and shows the message', async () => {
  const [gate, release] = gateOf();
  const { app, root, win } = setup({
    processAttempt: async (t, id, d, o) => { if (o && o.finish) await gate; return { state: o && o.finish ? 'finished' : 'inprogress', warnings: [] }; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/1';
  await settle();
  quizClick(root, 'Finish attempt');
  await settle();
  quizClick(root, 'Yes, submit');
  await tick();
  win.location.hash = '#/course/11/quiz/10'; // the user went back to the quiz while it was sending
  await settle();
  release();
  await settle();
  assert.match(root.querySelector('.pane-detail .flash').textContent, /Attempt finished/);
});

test('finishing after the user left for somewhere else leaves no stale message for a later visit', async () => {
  const [gate, release] = gateOf();
  const { app, root, win } = setup({
    processAttempt: async (t, id, d, o) => { if (o && o.finish) await gate; return { state: o && o.finish ? 'finished' : 'inprogress', warnings: [] }; },
  }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/1';
  await settle();
  quizClick(root, 'Finish attempt');
  await settle();
  quizClick(root, 'Yes, submit');
  await tick();
  win.location.hash = '#/course/11';
  await settle();
  release();
  await settle();
  win.location.hash = '#/course/11/quiz/10';
  await settle();
  assert.equal(root.querySelector('.pane-detail .flash'), null);
});

test('the finish summary ignores description items and counts invalid answers as unanswered', async () => {
  const { app, root, win } = setup({
    getAttemptSummary: async () => ({ questions: [
      { slot: 1, type: 'multichoice', state: 'complete' }, { slot: 2, type: 'truefalse', state: 'invalid' },
      { slot: 3, type: 'description', state: 'complete' }, { slot: 4, type: 'multichoice', state: 'todo' },
    ] }),
  }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/1';
  await settle();
  quizClick(root, 'Finish attempt');
  await settle();
  assert.match(root.querySelector('.pane-detail .confirm').textContent, /answered 1 of 3/);
});

test('a missing next page means the last page: no Next button, even if nextpage is null', async () => {
  const { app, root, win } = setup({ getAttemptData: async () => ({ ...sampleAttemptPage(0, null) }) }, true);
  await app.start();
  win.location.hash = '#/course/11/quiz/10/attempt/77/0';
  await settle();
  assert.equal(hasButton(root, 'Next'), false);
  assert.equal(hasButton(root, 'Finish attempt'), true);
});

test('without an explicit locale the app formats dates in the active app language', async () => {
  const { LANG } = await import('../src/strings.js');
  assert.equal(LANG, 'en');
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /locale = LANG\b/);
  assert.doesNotMatch(src, /navigator\.language/);
});
