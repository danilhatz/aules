import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createCache } from '../src/store.js';

test('set/get round-trips data with a timestamp', () => {
  const c = createCache(createMemoryStorage());
  c.set('courses', [{ id: 1 }]);
  const hit = c.get('courses');
  assert.deepEqual(hit.data, [{ id: 1 }]);
  assert.equal(typeof hit.savedAt, 'number');
  assert.equal(c.get('missing'), null);
});

test('clear removes every cached entry but not other keys', () => {
  const s = createMemoryStorage();
  s.setItem('aules.session', 'keep');
  const c = createCache(s);
  c.set('courses', [1]);
  c.set('course:5', [2]);
  c.clear();
  assert.equal(c.get('courses'), null);
  assert.equal(c.get('course:5'), null);
  assert.equal(s.getItem('aules.session'), 'keep');
});

test('corrupt entries read as a miss; quota errors do not throw', () => {
  const s = createMemoryStorage();
  const c = createCache(s);
  s.setItem('aules.cache.bad', '{oops');
  assert.equal(c.get('bad'), null);
  const full = { ...s, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  assert.doesNotThrow(() => createCache(full).set('x', 1));
});

test('a failed index write never leaves an orphaned entry that clear() cannot remove', () => {
  const s = createMemoryStorage();
  let writes = 0;
  const flaky = { ...s, setItem: (k, v) => { writes += 1; if (writes === 2) throw new DOMException('full', 'QuotaExceededError'); s.setItem(k, v); } };
  createCache(flaky).set('course:1', { big: true });
  createCache(s).clear();
  assert.equal(s.getItem('aules.cache.course:1'), null);
});
