import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../src/lang/en.js';
import { buildStrings, STRINGS, LANG } from '../src/strings.js';

test('plain Node has no saved choice and no phone language, so the app is English', () => {
  assert.equal(LANG, 'en');
  assert.equal(STRINGS.signIn, 'Sign in');
  assert.equal(STRINGS.errors.network, en.errors.network);
});

test('the language-switch labels exist', () => {
  for (const k of ['language', 'langAuto', 'langEn', 'langUk']) assert.ok(STRINGS[k], k);
});

test('a partial Ukrainian pack is merged over English, nested groups included', () => {
  const packs = { en, uk: { signIn: 'Увійти', errors: { network: 'Немає зв’язку' }, states: { draft: 'Чернетка' } } };
  const s = buildStrings('uk', packs);
  assert.equal(s.signIn, 'Увійти');
  assert.equal(s.errors.network, 'Немає зв’язку');
  assert.equal(s.errors.invalidlogin, en.errors.invalidlogin);
  assert.equal(s.states.draft, 'Чернетка');
  assert.equal(s.states.graded, en.states.graded);
  assert.equal(s.password, en.password);
});

test('English and unknown languages return English and never mutate the packs', () => {
  const packs = { en, uk: { signIn: 'Увійти' } };
  assert.equal(buildStrings('en', packs).signIn, 'Sign in');
  assert.equal(buildStrings('xx', packs).signIn, 'Sign in');
  buildStrings('uk', packs);
  assert.equal(en.signIn, 'Sign in');
  assert.equal(packs.uk.signIn, 'Увійти');
});

test('no value is ever undefined after a merge', () => {
  const s = buildStrings('uk', { en, uk: {} });
  const walk = (o, path) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, `${path}${k}.`); else assert.ok(typeof v === 'string' && v.length, path + k); } };
  walk(s, '');
});
