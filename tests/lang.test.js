import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../src/lang/en.js';
import { uk } from '../src/lang/uk.js';

// Same words in both languages on purpose (a product name and the language's own name).
const SAME_ON_PURPOSE = new Set(['appName', 'langEn', 'langUk']);

function flatten(o, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[prefix + k] = v;
  }
  return out;
}
const placeholders = (s) => (String(s).match(/\{[A-Za-z]+\}/g) || []).sort();

const E = flatten(en);
const U = flatten(uk);

test('Ukrainian has exactly the same keys as English', () => {
  assert.deepEqual(Object.keys(U).sort(), Object.keys(E).sort());
});

test('no Ukrainian string is empty or not a string', () => {
  for (const [k, v] of Object.entries(U)) assert.ok(typeof v === 'string' && v.trim().length > 0, k);
});

test('every {placeholder} survives translation', () => {
  for (const k of Object.keys(E)) assert.deepEqual(placeholders(U[k]), placeholders(E[k]), k);
  assert.deepEqual(placeholders(E.confirmStartTime), ['{min}']);
  assert.deepEqual(placeholders(E.summaryText), ['{done}', '{total}']);
});

test('translated strings are really translated (not left in English)', () => {
  for (const k of Object.keys(E)) {
    if (SAME_ON_PURPOSE.has(k)) continue;
    assert.notEqual(U[k], E[k], `${k} is still English`);
  }
});

test('Ukrainian strings contain Cyrillic', () => {
  for (const [k, v] of Object.entries(U)) {
    if (SAME_ON_PURPOSE.has(k)) continue;
    assert.match(v, /[Ѐ-ӿ]/, k);
  }
});
