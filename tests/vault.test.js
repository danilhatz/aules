import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createVault, createMemoryKeyStore } from '../src/vault.js';

const PASS = 'p&ss=w+d%é';

test('save/load round-trips; storage holds only ciphertext', async () => {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  assert.equal(await vault.save('10000001', PASS), true);
  assert.deepEqual(await vault.load(), { username: '10000001', password: PASS });
  const raw = storage.getItem('aules.vault');
  assert.ok(!raw.includes('10000001') && !raw.includes('ss=w'));
  assert.ok(!raw.includes(Buffer.from(PASS).toString('base64')));
});

test('the key is non-extractable', async () => {
  const keyStore = createMemoryKeyStore();
  const vault = createVault({ storage: createMemoryStorage(), keyStore });
  await vault.save('u', 'p');
  const key = await keyStore.get();
  assert.equal(key.extractable, false);
  await assert.rejects(() => globalThis.crypto.subtle.exportKey('raw', key));
});

test('clear wipes ciphertext and key', async () => {
  const storage = createMemoryStorage();
  const keyStore = createMemoryKeyStore();
  const vault = createVault({ storage, keyStore });
  await vault.save('u', 'p');
  await vault.clear();
  assert.equal(storage.getItem('aules.vault'), null);
  assert.equal(await keyStore.get(), null);
  assert.equal(await vault.load(), null);
});

test('load returns null for missing key, tampered or corrupt data', async () => {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  assert.equal(await vault.load(), null);
  await vault.save('u', 'p');
  const rec = JSON.parse(storage.getItem('aules.vault'));
  rec.ct = rec.ct.slice(0, -4) + 'AAAA';
  storage.setItem('aules.vault', JSON.stringify(rec));
  assert.equal(await vault.load(), null);
  storage.setItem('aules.vault', '{oops');
  assert.equal(await vault.load(), null);
  const other = createVault({ storage, keyStore: createMemoryKeyStore() });
  await vault.save('u', 'p');
  assert.equal(await other.load(), null); // a different key cannot decrypt
});

test('unavailable key storage means nothing is saved and nothing throws', async () => {
  const storage = createMemoryStorage();
  const broken = { get: async () => { throw new Error('no idb'); }, set: async () => { throw new Error('no idb'); } };
  const vault = createVault({ storage, keyStore: broken });
  assert.equal(await vault.save('u', 'p'), false);
  assert.equal(storage.getItem('aules.vault'), null);
  assert.equal(await vault.load(), null);
  await assert.doesNotReject(() => vault.clear());
});

test('a key store that never answers cannot hang save, load or clear', async () => {
  const hang = () => new Promise(() => {});
  const vault = createVault({ storage: createMemoryStorage(), keyStore: { get: hang, set: hang, clear: hang }, timeoutMs: 20 });
  assert.equal(await vault.save('u', 'p'), false);
  assert.equal(await vault.load(), null);
  await vault.clear();
});
