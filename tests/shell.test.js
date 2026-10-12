import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const SHELL = JSON.parse(/const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1]);

const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

test('every SHELL entry exists on disk', () => {
  for (const p of SHELL) {
    if (p === './') continue;
    assert.ok(existsSync(join(root, p)), p);
  }
});

test('every source module and style is in the SHELL (nothing forgotten)', () => {
  for (const f of walk('src')) assert.ok(SHELL.includes(`./${f}`), f);
  for (const f of ['index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.ok(SHELL.includes(`./${f}`), f);
  }
});

test('manifest is installable on iOS/Android and uses relative paths', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) assert.ok(existsSync(join(root, i.src)), i.src);
});

test('index.html enforces CSP limited to aules and no-referrer', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /connect-src https:\/\/aules\.edu\.gva\.es/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="apple-touch-icon"/);
});
