import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reads VERSION and the SHELL file list out of sw.js.
export function readShell(root) {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const version = /const VERSION = "([^"]+)"/.exec(sw)[1];
  const files = JSON.parse(/const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1]);
  return { version, files };
}

// Hash of every file the service worker caches (sw.js itself is not in the list).
export function shellHash(root) {
  const { files } = readShell(root);
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    const path = f === './' ? 'index.html' : f.replace(/^\.\//, '');
    h.update(`${path}\n`);
    h.update(readFileSync(join(root, path)));
  }
  return h.digest('hex');
}

// The app files are served cache-first, so changed files only reach installed phones when VERSION changes.
export function checkLock({ lock, version, hash }) {
  if (!lock) return { ok: true, write: true };
  if (lock.hash === hash && lock.version === version) return { ok: true, write: false };
  if (lock.hash !== hash && lock.version === version) {
    return { ok: false, error: `App files changed but VERSION in sw.js is still ${version}. Bump VERSION first.` };
  }
  return { ok: true, write: true };
}
