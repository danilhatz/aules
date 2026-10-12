import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage, getStorage } from '../src/storage.js';
import { createAuth } from '../src/auth.js';

const api = {
  requestToken: async () => 'tok',
  getSiteInfo: async () => ({ userid: 7, fullname: 'Ana Test' }),
};

test('login stores token/userid/fullname and never the password', async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  const session = await auth.login('10000001', 'S3cret&pass');
  assert.deepEqual(session, { token: 'tok', userid: 7, fullname: 'Ana Test' });
  assert.deepEqual(auth.getSession(), session);
  const raw = storage.getItem('aules.session');
  assert.ok(!raw.includes('S3cret'));
});

test('logout clears the session', async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  await auth.login('u', 'p');
  auth.logout();
  assert.equal(auth.getSession(), null);
  assert.equal(storage.getItem('aules.session'), null);
});

test('corrupt or incomplete stored session is treated as logged out', () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  storage.setItem('aules.session', '{not json');
  assert.equal(auth.getSession(), null);
  storage.setItem('aules.session', JSON.stringify({ token: 'x' }));
  assert.equal(auth.getSession(), null);
});

test('failed login leaves no session', async () => {
  const storage = createMemoryStorage();
  const bad = { ...api, requestToken: async () => { throw Object.assign(new Error('x'), { code: 'invalidlogin' }); } };
  const auth = createAuth({ storage, api: bad });
  await assert.rejects(() => auth.login('u', 'p'));
  assert.equal(auth.getSession(), null);
});

test('getStorage falls back to memory when localStorage throws (Safari private mode)', () => {
  const win = { get localStorage() { throw new DOMException('denied', 'SecurityError'); } };
  const s = getStorage(win);
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
  const none = getStorage({});
  none.setItem('b', '2');
  assert.equal(none.getItem('b'), '2');
});

test('getStorage returns real localStorage when usable', () => {
  const store = new Map();
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(getStorage({ localStorage: fake }), fake);
});
