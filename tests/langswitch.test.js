import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { createMemoryStorage } from '../src/storage.js';
import { PREF_KEY } from '../src/i18n.js';

setupDom();
const { renderLangSwitch } = await import('../src/ui/langswitch.js');
const { renderLogin } = await import('../src/ui/login.js');

const change = (sel, value) => { sel.value = value; sel.dispatchEvent(new window.Event('change')); };

test('offers Auto, English and Українська and shows the saved choice', () => {
  const storage = createMemoryStorage();
  storage.setItem(PREF_KEY, 'uk');
  const el = renderLangSwitch({ storage, reload() {} });
  const sel = el.querySelector('select');
  assert.deepEqual([...sel.options].map((o) => o.value), ['auto', 'en', 'uk']);
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['Auto (phone)', 'English', 'Українська']);
  assert.equal(sel.value, 'uk');
  assert.equal(el.tagName, 'LABEL');
});

test('defaults to Auto when nothing is saved or the saved value is garbage', () => {
  const storage = createMemoryStorage();
  assert.equal(renderLangSwitch({ storage, reload() {} }).querySelector('select').value, 'auto');
  storage.setItem(PREF_KEY, 'zz');
  assert.equal(renderLangSwitch({ storage, reload() {} }).querySelector('select').value, 'auto');
});

test('choosing a language saves it and reloads once', () => {
  const storage = createMemoryStorage();
  let reloads = 0;
  const sel = renderLangSwitch({ storage, reload: () => { reloads += 1; } }).querySelector('select');
  change(sel, 'uk');
  assert.equal(storage.getItem(PREF_KEY), 'uk');
  assert.equal(reloads, 1);
  change(sel, 'auto');
  assert.equal(storage.getItem(PREF_KEY), null);
  assert.equal(reloads, 2);
});

test('a value the app does not know is ignored: nothing saved, no reload', () => {
  const storage = createMemoryStorage();
  let reloads = 0;
  const sel = renderLangSwitch({ storage, reload: () => { reloads += 1; } }).querySelector('select');
  const odd = document.createElement('option'); odd.value = 'fr'; sel.append(odd);
  change(sel, 'fr');
  assert.equal(storage.getItem(PREF_KEY), null);
  assert.equal(reloads, 0);
});

test('if the choice cannot be stored the page is not reloaded', () => {
  const storage = { getItem: () => null, setItem() { throw new Error('full'); }, removeItem() { throw new Error('full'); } };
  let reloads = 0;
  const sel = renderLangSwitch({ storage, reload: () => { reloads += 1; } }).querySelector('select');
  change(sel, 'uk');
  assert.equal(reloads, 0);
});

test('works with no storage at all', () => {
  const sel = renderLangSwitch({ storage: null, reload() {} }).querySelector('select');
  assert.equal(sel.value, 'auto');
  assert.doesNotThrow(() => change(sel, 'uk'));
});

test('the login screen carries the switch', () => {
  const el = renderLogin({ onSubmit: async () => {} });
  assert.ok(el.querySelector('.lang-switch select'));
});
