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

test('a draft remembers the server text it was typed against', () => {
  const d = createDrafts(createMemoryStorage());
  d.set(7, 'mi borrador', '1|<p>base</p>');
  assert.equal(d.get(7).base, '1|<p>base</p>');
  d.set(8, 'sin base');
  assert.equal(d.get(8).base, '');
});
