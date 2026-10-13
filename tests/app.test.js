import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections, sampleAssignmentsResponse, sampleStatusResponse } from './fixtures.js';
import { MoodleError } from '../src/api.js';
import { createMemoryStorage } from '../src/storage.js';

const { createApp } = await import('../src/app.js');
const { createAuth } = await import('../src/auth.js');
const { createCache } = await import('../src/store.js');
const { createVault, createMemoryKeyStore } = await import('../src/vault.js');
const { createDrafts } = await import('../src/drafts.js');

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
    ...apiOverrides,
  };
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  const auth = createAuth({ storage, api, vault });
  const cache = createCache(storage);
  if (preloadSession) storage.setItem('aules.session', JSON.stringify({ token: 'tok', userid: 7, fullname: 'Ana' }));
  const root = document.getElementById('app');
  const drafts = createDrafts(storage);
  const app = createApp({ root, api, auth, cache, win: dom.window, drafts, nowFn: () => 1785000000, locale: 'en' });
  return { app, root, storage, auth, cache, vault, drafts, api, win: dom.window };
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
