import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections } from './fixtures.js';
import { MoodleError } from '../src/api.js';
import { createMemoryStorage } from '../src/storage.js';

const { createApp } = await import('../src/app.js');
const { createAuth } = await import('../src/auth.js');
const { createCache } = await import('../src/store.js');
const { createVault, createMemoryKeyStore } = await import('../src/vault.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(apiOverrides = {}, preloadSession = false) {
  const dom = setupDom();
  const storage = createMemoryStorage();
  const api = {
    requestToken: async () => 'tok',
    getSiteInfo: async () => ({ userid: 7, fullname: 'Ana' }),
    getCourses: async () => sampleCourses,
    getCourseContents: async () => sampleSections,
    ...apiOverrides,
  };
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  const auth = createAuth({ storage, api, vault });
  const cache = createCache(storage);
  if (preloadSession) storage.setItem('aules.session', JSON.stringify({ token: 'tok', userid: 7, fullname: 'Ana' }));
  const root = document.getElementById('app');
  const app = createApp({ root, api, auth, cache, win: dom.window });
  return { app, root, storage, auth, cache, vault, api, win: dom.window };
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
