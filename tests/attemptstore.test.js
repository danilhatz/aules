import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createAttemptStore } from '../src/attemptstore.js';

const snap = (v) => ({ t: { 'q5:1_answer': v }, c: {} });

test('snapshots are kept per attempt and page', () => {
  const s = createAttemptStore(createMemoryStorage());
  assert.equal(s.get(9, 0), null);
  s.set(9, 0, snap('a'));
  s.set(9, 1, snap('b'));
  s.set(10, 0, snap('c'));
  assert.equal(s.get(9, 0).t['q5:1_answer'], 'a');
  assert.equal(s.get(9, 1).t['q5:1_answer'], 'b');
  assert.equal(s.get(10, 0).t['q5:1_answer'], 'c');
  assert.equal(s.get(9, 2), null);
  s.set(9, 0, snap('z'));
  assert.equal(s.get(9, 0).t['q5:1_answer'], 'z');
  assert.equal(s.get(9, 1).t['q5:1_answer'], 'b');
});

test('remove drops one attempt; clear drops all and nothing else', () => {
  const st = createMemoryStorage();
  st.setItem('aules.session', 'keep');
  const s = createAttemptStore(st);
  s.set(1, 0, snap('a')); s.set(2, 0, snap('b'));
  s.remove(1);
  assert.equal(s.get(1, 0), null);
  assert.equal(s.get(2, 0).t['q5:1_answer'], 'b');
  s.clear();
  assert.equal(s.get(2, 0), null);
  assert.equal(st.getItem('aules.session'), 'keep');
  assert.equal(st.getItem('aules.attempt.2'), null);
});

test('corrupt data is a miss; storage failures never throw; a failed data write leaves nothing clear() cannot remove', () => {
  const st = createMemoryStorage();
  st.setItem('aules.attempt.5', '{oops');
  assert.equal(createAttemptStore(st).get(5, 0), null);
  const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  const b = createAttemptStore(boom);
  assert.doesNotThrow(() => { b.set(1, 0, snap('a')); b.remove(1); b.clear(); });
  assert.equal(b.get(1, 0), null);

  const st2 = createMemoryStorage();
  let writes = 0;
  const flaky = { ...st2, setItem: (k, v) => { writes += 1; if (writes === 2) throw new DOMException('full', 'QuotaExceededError'); st2.setItem(k, v); } };
  createAttemptStore(flaky).set(3, 0, snap('big'));
  createAttemptStore(st2).clear();
  assert.equal(st2.getItem('aules.attempt.3'), null);
});

test('removePage drops only that page of one attempt', () => {
  const s = createAttemptStore(createMemoryStorage());
  s.set(9, 0, snap('a')); s.set(9, 1, snap('b')); s.set(10, 0, snap('c'));
  s.removePage(9, 0);
  assert.equal(s.get(9, 0), null);
  assert.equal(s.get(9, 1).t['q5:1_answer'], 'b');
  assert.equal(s.get(10, 0).t['q5:1_answer'], 'c');
  assert.doesNotThrow(() => { s.removePage(9, 5); s.removePage(77, 0); });
});
