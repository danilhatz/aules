import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createVault, createMemoryKeyStore } from '../src/vault.js';
import { createAuth } from '../src/auth.js';

function setup(apiOverrides = {}) {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  let n = 0;
  const calls = [];
  const api = {
    requestToken: async (u, p) => { calls.push([u, p]); n += 1; return `tok${n}`; },
    getSiteInfo: async () => ({ userid: 7, fullname: 'Ana' }),
    ...apiOverrides,
  };
  return { storage, vault, api, calls, auth: createAuth({ storage, api, vault }) };
}

test('login saves credentials; relogin silently gets a fresh token', async () => {
  const { auth, calls } = setup();
  await auth.login('10000001', 'S3cret&pass');
  assert.equal(auth.getSession().token, 'tok1');
  const fresh = await auth.relogin();
  assert.equal(fresh.token, 'tok2');
  assert.equal(auth.getSession().token, 'tok2');
  assert.deepEqual(calls[1], ['10000001', 'S3cret&pass']);
});

test('the session record never contains the password', async () => {
  const { auth, storage } = setup();
  await auth.login('u', 'S3cret&pass');
  assert.ok(!storage.getItem('aules.session').includes('S3cret'));
});

test('relogin returns null with no vault or nothing saved', async () => {
  const { storage, api } = setup();
  assert.equal(await createAuth({ storage, api }).relogin(), null);
  const { auth } = setup();
  assert.equal(await auth.relogin(), null);
});

test('rejected saved password wipes the vault and rejects', async () => {
  let reject = false;
  const { auth, vault } = setup({
    requestToken: async () => { if (reject) throw Object.assign(new Error('x'), { code: 'invalidlogin' }); return 'tok'; },
  });
  await auth.login('u', 'p');
  reject = true;
  await assert.rejects(() => auth.relogin(), (e) => e.code === 'invalidlogin');
  assert.equal(await vault.load(), null);
});

test('network failure during relogin keeps the saved credentials', async () => {
  let down = false;
  const { auth, vault } = setup({
    requestToken: async () => { if (down) throw Object.assign(new Error('x'), { code: 'network' }); return 'tok'; },
  });
  await auth.login('u', 'p');
  down = true;
  await assert.rejects(() => auth.relogin(), (e) => e.code === 'network');
  assert.deepEqual(await vault.load(), { username: 'u', password: 'p' });
});

test('logout clears session and vault', async () => {
  const { auth, vault } = setup();
  await auth.login('u', 'p');
  await auth.logout();
  assert.equal(auth.getSession(), null);
  assert.equal(await vault.load(), null);
});

test('logout during an in-flight silent renewal is not undone by the renewal', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const { auth, storage } = setup({ requestToken: async () => { n += 1; if (n > 1) await gate; return `tok${n}`; } });
  await auth.login('u', 'p');
  const pending = auth.relogin();
  await new Promise((r) => setTimeout(r, 5));
  await auth.logout();
  release();
  await assert.rejects(pending, (e) => e.code === 'aborted');
  assert.equal(auth.getSession(), null);
  assert.equal(storage.getItem('aules.session'), null);
});
