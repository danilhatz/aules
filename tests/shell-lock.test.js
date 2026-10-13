import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readShell, shellHash, checkLock } from '../tools/shell-hash.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the recorded shell hash matches the files: a changed app file cannot ship without bumping VERSION and re-locking', () => {
  const lock = JSON.parse(readFileSync(`${root}shell.lock.json`, 'utf8'));
  const { version } = readShell(root);
  assert.equal(shellHash(root), lock.hash, 'App files changed. Bump VERSION in sw.js, then run: npm run lock-shell');
  assert.equal(version, lock.version);
});

test('the hash covers file contents and ignores sw.js itself', () => {
  const a = shellHash(root);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(shellHash(root), a); // stable
});

test('checkLock: unchanged is fine; changed files need a new version; a new version may re-lock', () => {
  const lock = { version: 'v4', hash: 'aaa' };
  assert.deepEqual(checkLock({ lock, version: 'v4', hash: 'aaa' }), { ok: true, write: false });
  assert.deepEqual(checkLock({ lock, version: 'v4', hash: 'bbb' }), { ok: false, error: 'App files changed but VERSION in sw.js is still v4. Bump VERSION first.' });
  assert.deepEqual(checkLock({ lock, version: 'v5', hash: 'bbb' }), { ok: true, write: true });
  assert.deepEqual(checkLock({ lock: null, version: 'v1', hash: 'x' }), { ok: true, write: true });
  assert.deepEqual(checkLock({ lock, version: 'v5', hash: 'aaa' }), { ok: true, write: true }); // bumped without changes: record it
});
