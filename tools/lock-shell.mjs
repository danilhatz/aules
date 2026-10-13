import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLock, readShell, shellHash } from './shell-hash.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const lockPath = `${root}shell.lock.json`;
const { version } = readShell(root);
const hash = shellHash(root);
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
const result = checkLock({ lock, version, hash });
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
if (result.write) {
  writeFileSync(lockPath, `${JSON.stringify({ version, hash }, null, 2)}\n`);
  console.log(`locked ${version} ${hash.slice(0, 12)}`);
} else {
  console.log(`already locked ${version}`);
}
