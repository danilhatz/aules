import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

test('category-folder styles are scoped to details.folder so Aules "Folder" activities (li.mod.folder) are not styled as cards', () => {
  const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((m) => m[2].split(',').map((s) => s.trim()));
  const bare = selectors.filter((s) => /^\.folder(\s|$|>|\.)/.test(s));
  assert.deepEqual(bare, []);
  assert.ok(selectors.some((s) => s.startsWith('details.folder')));
});

test('folders and units show an expand/collapse chevron (summary markers are removed by display:flex)', () => {
  assert.ok(css.includes('details.folder > summary::after'));
  assert.ok(css.includes('.unit > summary::after'));
  assert.ok(css.includes('[open] > summary::after'));
});
