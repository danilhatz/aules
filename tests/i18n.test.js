import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, PREF_KEY, resolveLanguage, readPreference, savePreference, deviceStorage } from '../src/i18n.js';
import { createMemoryStorage } from '../src/storage.js';

test('constants', () => {
  assert.deepEqual(LANGUAGES, ['en', 'uk']);
  assert.equal(PREF_KEY, 'aules.lang');
});

test('an explicit choice wins over the phone language', () => {
  assert.equal(resolveLanguage('en', ['uk-UA']), 'en');
  assert.equal(resolveLanguage('uk', ['en-US']), 'uk');
});

test('auto follows the first supported phone language', () => {
  assert.equal(resolveLanguage('auto', ['uk-UA', 'en-US']), 'uk');
  assert.equal(resolveLanguage('auto', ['UK']), 'uk');
  assert.equal(resolveLanguage('auto', ['uk']), 'uk');
  assert.equal(resolveLanguage('auto', ['en-GB']), 'en');
  assert.equal(resolveLanguage(undefined, ['ru-RU', 'uk-UA']), 'uk');
});

test('unsupported, empty or malformed input falls back to English', () => {
  assert.equal(resolveLanguage('auto', ['ru', 'pl']), 'en');
  assert.equal(resolveLanguage('auto', []), 'en');
  assert.equal(resolveLanguage('auto', undefined), 'en');
  assert.equal(resolveLanguage('auto', 'uk'), 'en');
  assert.equal(resolveLanguage('auto', [null, 5, {}]), 'en');
  assert.equal(resolveLanguage('xx', ['fr']), 'en');
  assert.equal(resolveLanguage(null, null), 'en');
});

test('preference round-trips and auto clears it', () => {
  const s = createMemoryStorage();
  assert.equal(readPreference(s), 'auto');
  assert.equal(savePreference(s, 'uk'), true);
  assert.equal(s.getItem(PREF_KEY), 'uk');
  assert.equal(readPreference(s), 'uk');
  assert.equal(savePreference(s, 'auto'), true);
  assert.equal(s.getItem(PREF_KEY), null);
  assert.equal(readPreference(s), 'auto');
});

test('garbage preference and bad values are ignored', () => {
  const s = createMemoryStorage();
  for (const bad of ['xx', '', '"uk"', '{"a":1}', 'null']) {
    s.setItem(PREF_KEY, bad);
    assert.equal(readPreference(s), 'auto', bad);
  }
  assert.equal(savePreference(s, 'fr'), false);
  assert.equal(savePreference(s, undefined), false);
});

test('storage that throws or is missing never breaks anything', () => {
  const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(readPreference(boom), 'auto');
  assert.equal(savePreference(boom, 'uk'), false);
  assert.equal(savePreference(boom, 'auto'), false);
  assert.equal(readPreference(null), 'auto');
  assert.equal(readPreference(undefined), 'auto');
  assert.equal(savePreference(null, 'uk'), false);
});

test('deviceStorage returns null where localStorage does not exist', () => {
  assert.equal(deviceStorage(), null);
});

test('localeFor keeps the phone region for dates when the language matches, else the bare language', async () => {
  const { localeFor } = await import('../src/i18n.js');
  assert.equal(localeFor('en', ['es-ES', 'en-GB']), 'en-GB');
  assert.equal(localeFor('uk', ['uk-UA']), 'uk-UA');
  assert.equal(localeFor('en', ['uk-UA']), 'en'); // user forced English on a Ukrainian phone
  assert.equal(localeFor('uk', []), 'uk');
  assert.equal(localeFor('en', undefined), 'en');
  assert.equal(localeFor('en', ['en-@@@']), 'en'); // not a valid tag
});
