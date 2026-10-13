import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createFolderState } from '../src/folders.js';

test('get returns undefined until set; set persists booleans per folder name', () => {
  const s = createMemoryStorage();
  const f = createFolderState(s);
  assert.equal(f.get('A'), undefined);
  f.set('A', false);
  f.set('B', true);
  assert.equal(createFolderState(s).get('A'), false);
  assert.equal(createFolderState(s).get('B'), true);
});

test('corrupt storage and odd names are safe', () => {
  const s = createMemoryStorage();
  s.setItem('aules.folders', '{oops');
  const f = createFolderState(s);
  assert.equal(f.get('A'), undefined);
  assert.equal(f.get('__proto__'), undefined);
  f.set('__proto__', true);
  assert.equal(f.get('__proto__'), true);
});

test('storage failures never throw', () => {
  const s = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  const f = createFolderState(s);
  assert.doesNotThrow(() => f.set('A', true));
  assert.equal(f.get('A'), undefined);
});
