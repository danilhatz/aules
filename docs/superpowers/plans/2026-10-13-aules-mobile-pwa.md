# Aules Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, Safari-installable PWA for iPhone/iPad that signs in to https://aules.edu.gva.es/fpa through Moodle's mobile web-service API and shows the user's courses and course content in a clean adaptive layout.

**Architecture:** Vanilla ES modules, no build step. `api.js` speaks the Moodle protocol, `auth.js`/`storage.js` own the token, `store.js` caches responses, `sanitize.js`/`content.js` turn Moodle payloads into safe view models, `ui/*` render DOM, `app.js` wires them together via an injectable factory (`createApp`) so everything is testable in jsdom. A service worker caches the app shell.

**Tech Stack:** Browser ES modules, Fetch, Service Worker, localStorage. Dev only: Node >= 20 (`node:test`), `jsdom`.

**Spec:** `docs/superpowers/specs/2026-10-13-aules-mobile-pwa-design.md`

## Global Constraints

- Static PWA, vanilla ES modules, **no build step**; served over HTTPS from static hosting (GitHub Pages target). **Nothing is published without the user's explicit approval.**
- Site base URL: `https://aules.edu.gva.es/fpa`; token service: `moodle_mobile_app`.
- Data goes phone -> aules directly; no backend, no proxy.
- The password is never logged or put in a URL. By the user's decision it **is** saved on the device, only inside the vault: AES-GCM ciphertext in localStorage, key is a non-extractable `CryptoKey` in IndexedDB; used solely for silent token renewal on `invalidtoken`. If vault storage is unavailable nothing is saved. Sign out deletes ciphertext + key + token + cache. **No credentials appear in source, tests, fixtures, or docs.** The assistant never enters the user's real credentials into the live site; the first real login is done by the user on their device.
- Strict CSP in `index.html`: `connect-src` limited to the aules origin; `<meta name="referrer" content="no-referrer">`.
- All Moodle-supplied HTML goes through the allow-list sanitizer (no scripts, event handlers, or `javascript:` URLs).
- Logout deletes the token **and** cached data.
- UX: mobile-first, safe-area aware (notch/home indicator), `standalone` display, large touch targets, iPad two-column master/detail, light + dark mode, offline app shell via service worker, cached courses shown when offline.
- v1 scope: login, course list, course content (sections; files, links, pages, folders, labels), logout. Out: assignments/calendar, grades, messages, forums, quizzes, uploads.
- Tests: `node --test` (no test framework beyond Node + jsdom).

## Review Focus

Failure modes the spec implies but no feature task would otherwise pin (each has a test in the named task):

1. Password containing `& = + % ;` spaces and non-ASCII (`p&ss=w+d%é`) reaches Moodle intact, in the POST body, never in the URL. (Task 2)
2. Moodle returns **HTTP 200 with an error JSON** (`invalidlogin`, `invalidtoken`, exception shape), a non-JSON body, or the request fails offline: each surfaces as a typed error, never as data. (Task 2)
3. Safari private mode / blocked storage: `localStorage` throws -> app falls back to in-memory storage and still logs in. (Task 3)
4. Hostile or messy HTML in labels/pages (`<script>`, `onerror=`, `jav&#x09;ascript:` links, `<svg>`, `style=`, `data:` images). (Task 5)
5. File URLs that already carry a query string get `&token=` correctly, and the token is **never** appended to non-aules hosts; `javascript:` URL modules are dropped. (Task 6)
6. Silent renewal edge cases: saved password rejected (changed) -> vault wiped and login shown; renewal fails only because offline -> credentials kept and cached data shown; renewal retried **once** (no infinite loop if the fresh token is also rejected); vault ciphertext never contains the plaintext password. (Tasks 3b and 8)

---

## File Structure

```
package.json            scripts + jsdom devDependency
.gitignore
index.html              shell, CSP, meta, loads src/main.js
manifest.webmanifest
sw.js                   app-shell cache (stale-while-revalidate)
icons/                  generated PNG icons (180/192/512)
src/
  config.js             SITE_URL, SERVICE
  strings.js            all UI strings (single place to translate)
  errors.js             describeError(err)
  api.js                MoodleError, requestToken, getSiteInfo, getCourses, getCourseContents
  storage.js            getStorage(), createMemoryStorage()
  auth.js               createAuth({storage, api, vault?}) incl. silent relogin()
  vault.js              createVault, createMemoryKeyStore, createIdbKeyStore
  store.js              createCache(storage)
  sanitize.js           sanitizeHtml, isSafeHttpUrl
  content.js            withToken, buildCourse
  app.js                createApp({root, api, auth, cache, win})
  main.js               real wiring + SW registration
  styles.css
  ui/dom.js             h(), clear()
  ui/login.js           renderLogin
  ui/courses.js         renderCourseList
  ui/course.js          renderCourse, renderBack
tests/
  helpers/dom.js        setupDom() (jsdom globals)
  fixtures.js           sampleCourses, sampleSections (shared with preview)
  *.test.js
tools/
  serve.mjs             static dev server (localhost only)
  make-icons.mjs        PNG icon generator
  preview.html/.js      fixture-driven demo for visual checks (no network)
README.md
```

---

### Task 1: Scaffold, config, strings

**Files:**
- Create: `package.json`, `.gitignore`, `src/config.js`, `src/strings.js`, `tests/config.test.js`

**Interfaces:**
- Produces: `SITE_URL: string`, `SERVICE: string` (config.js); `STRINGS` object (strings.js) with keys: `appName, signIn, username, password, courses, search, back, offline, logout, section, saveNote, unsupported, loading, empty, noContent, retry, pickCourse` and `errors: {invalidlogin, invalidtoken, network, badresponse, notoken, servicenotavailable, unknown}`.

- [ ] **Step 1: Check tooling and init repo**

Run: `node --version` (must be >= v20; if missing, stop and ask the user to install Node LTS) then `git init` in `C:\aula`.

- [ ] **Step 2: Write `package.json` and `.gitignore`**

```json
{
  "name": "aules-mobile",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "node tools/serve.mjs"
  },
  "devDependencies": {
    "jsdom": "^24.1.0"
  }
}
```
`.gitignore`:
```
node_modules/
```

- [ ] **Step 3: Write the failing test** `tests/config.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_URL, SERVICE } from '../src/config.js';
import { STRINGS } from '../src/strings.js';

test('config points at aules over https with no trailing slash', () => {
  assert.equal(SITE_URL, 'https://aules.edu.gva.es/fpa');
  assert.equal(SERVICE, 'moodle_mobile_app');
});

test('strings define every error code the UI can show', () => {
  for (const k of ['invalidlogin', 'invalidtoken', 'network', 'badresponse', 'notoken', 'servicenotavailable', 'unknown']) {
    assert.ok(STRINGS.errors[k], k);
  }
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm install` then `npm test`
Expected: FAIL, cannot find `../src/config.js`.

- [ ] **Step 5: Implement**

`src/config.js`:
```js
export const SITE_URL = 'https://aules.edu.gva.es/fpa';
export const SERVICE = 'moodle_mobile_app';
```
`src/strings.js`:
```js
export const STRINGS = {
  appName: 'Aules',
  signIn: 'Sign in',
  username: 'User number',
  password: 'Password',
  courses: 'My courses',
  search: 'Search courses',
  back: 'Courses',
  offline: 'Offline: showing saved data',
  logout: 'Sign out',
  section: 'Section',
  saveNote: 'Your login is saved encrypted on this device so the app can renew your session automatically. Sign out removes it.',
  unsupported: 'Not available in this app yet',
  loading: 'Loading…',
  empty: 'No courses found',
  noContent: 'This course has no content',
  retry: 'Retry',
  pickCourse: 'Select a course',
  errors: {
    invalidlogin: 'Wrong user number or password.',
    invalidtoken: 'Your session expired. Please sign in again.',
    network: 'Cannot reach Aules. Check your connection.',
    badresponse: 'Aules sent an unexpected response.',
    notoken: 'Aules did not issue an access token for this account.',
    servicenotavailable: 'The mobile service is not enabled for this account.',
    unknown: 'Something went wrong.',
  },
};
```

- [ ] **Step 6: Run tests, expect PASS**, then commit

```bash
git add -A && git commit -m "chore: scaffold project, config and strings"
```

---

### Task 2: Moodle API client + error messages

**Files:**
- Create: `src/api.js`, `src/errors.js`, `tests/api.test.js`

**Interfaces:**
- Consumes: `SITE_URL`, `SERVICE`, `STRINGS`.
- Produces:
  - `class MoodleError extends Error { code: string }` — codes: Moodle `errorcode`s plus `'network' | 'badresponse' | 'notoken'`.
  - `requestToken(username, password, opts?) -> Promise<string>`
  - `getSiteInfo(token, opts?) -> Promise<{userid:number, fullname:string, ...}>`
  - `getCourses(token, userid, opts?) -> Promise<Course[]>`
  - `getCourseContents(token, courseId, opts?) -> Promise<Section[]>`
  - `opts = { fetchImpl? }` (defaults to global `fetch`).
  - `describeError(err) -> string` (errors.js).

- [ ] **Step 1: Write the failing tests** `tests/api.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestToken, getSiteInfo, getCourses, getCourseContents, MoodleError } from '../src/api.js';
import { describeError } from '../src/errors.js';

const ok = (payload, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => payload };
};

test('requestToken sends credentials in the POST body, encoded, never in the URL', async () => {
  const calls = [];
  const password = 'p&ss=w+d%é ;x';
  const token = await requestToken('10000001', password, { fetchImpl: ok({ token: 'tok123' }, calls) });
  assert.equal(token, 'tok123');
  const { url, opts } = calls[0];
  assert.equal(url, 'https://aules.edu.gva.es/fpa/login/token.php');
  assert.equal(opts.method, 'POST');
  assert.ok(!url.includes('p&ss') && !url.includes('10000001'));
  const body = new URLSearchParams(opts.body.toString());
  assert.equal(body.get('username'), '10000001');
  assert.equal(body.get('password'), password);
  assert.equal(body.get('service'), 'moodle_mobile_app');
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.referrerPolicy, 'no-referrer');
});

test('HTTP 200 with error JSON becomes MoodleError with the Moodle errorcode', async () => {
  const f = ok({ error: 'bad creds', errorcode: 'invalidlogin' });
  await assert.rejects(() => requestToken('u', 'p', { fetchImpl: f }), (e) => e instanceof MoodleError && e.code === 'invalidlogin');
});

test('exception-shaped payloads are errors too', async () => {
  const f = ok({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  await assert.rejects(() => getSiteInfo('t', { fetchImpl: f }), (e) => e.code === 'invalidtoken');
});

test('missing token in a 200 response -> notoken', async () => {
  await assert.rejects(() => requestToken('u', 'p', { fetchImpl: ok({}) }), (e) => e.code === 'notoken');
});

test('network failure -> network; non-JSON body -> badresponse', async () => {
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => getCourses('t', 1, { fetchImpl: down }), (e) => e.code === 'network');
  const html = async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(() => getCourses('t', 1, { fetchImpl: html }), (e) => e.code === 'badresponse');
});

test('web-service calls send wstoken, wsfunction, json format and params', async () => {
  const calls = [];
  const courses = await getCourses('tok', 42, { fetchImpl: ok([{ id: 1 }], calls) });
  assert.deepEqual(courses, [{ id: 1 }]);
  assert.equal(calls[0].url, 'https://aules.edu.gva.es/fpa/webservice/rest/server.php');
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wstoken'), 'tok');
  assert.equal(b.get('wsfunction'), 'core_enrol_get_users_courses');
  assert.equal(b.get('moodlewsrestformat'), 'json');
  assert.equal(b.get('userid'), '42');

  const calls2 = [];
  await getCourseContents('tok', 7, { fetchImpl: ok([], calls2) });
  const b2 = new URLSearchParams(calls2[0].opts.body.toString());
  assert.equal(b2.get('wsfunction'), 'core_course_get_contents');
  assert.equal(b2.get('courseid'), '7');

  const calls3 = [];
  await getSiteInfo('tok', { fetchImpl: ok({ userid: 5 }, calls3) });
  assert.equal(new URLSearchParams(calls3[0].opts.body.toString()).get('wsfunction'), 'core_webservice_get_site_info');
});

test('describeError maps known codes and falls back with the code shown', () => {
  assert.match(describeError(new MoodleError('invalidlogin')), /Wrong user number/);
  assert.match(describeError(new MoodleError('weird_code')), /Something went wrong.*weird_code/);
  assert.match(describeError(new Error('x')), /Something went wrong/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`npm test`: cannot find `../src/api.js`).

- [ ] **Step 3: Implement** `src/api.js`

```js
import { SITE_URL, SERVICE } from './config.js';

export class MoodleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'MoodleError';
    this.code = code;
  }
}

async function post(url, params, fetchImpl) {
  const f = fetchImpl || globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await f(url, {
      method: 'POST',
      body: new URLSearchParams(params),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new MoodleError('network');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new MoodleError('badresponse');
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && (data.error || data.exception || data.errorcode)) {
    throw new MoodleError(data.errorcode || data.exception || 'unknown', data.error || data.message);
  }
  return data;
}

export async function requestToken(username, password, { fetchImpl } = {}) {
  const data = await post(`${SITE_URL}/login/token.php`, { username, password, service: SERVICE }, fetchImpl);
  if (!data || !data.token) throw new MoodleError('notoken');
  return data.token;
}

function ws(token, wsfunction, params, fetchImpl) {
  return post(
    `${SITE_URL}/webservice/rest/server.php`,
    { wstoken: token, wsfunction, moodlewsrestformat: 'json', ...params },
    fetchImpl,
  );
}

export const getSiteInfo = (token, { fetchImpl } = {}) =>
  ws(token, 'core_webservice_get_site_info', {}, fetchImpl);

export const getCourses = (token, userid, { fetchImpl } = {}) =>
  ws(token, 'core_enrol_get_users_courses', { userid }, fetchImpl);

export const getCourseContents = (token, courseId, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_contents', { courseid: courseId }, fetchImpl);
```

`src/errors.js`:
```js
import { STRINGS as S } from './strings.js';

export function describeError(err) {
  const code = err && err.code;
  if (code && S.errors[code]) return S.errors[code];
  return code ? `${S.errors.unknown} (${code})` : S.errors.unknown;
}
```

- [ ] **Step 4: Run, expect PASS**, commit

```bash
git add -A && git commit -m "feat: Moodle API client and error messages"
```

---

### Task 3: Storage fallback + auth

**Files:**
- Create: `src/storage.js`, `src/auth.js`, `tests/auth.test.js`

**Interfaces:**
- Consumes: `api.requestToken`, `api.getSiteInfo` (any object with those two functions).
- Produces:
  - `createMemoryStorage() -> {getItem, setItem, removeItem}`
  - `getStorage(win = globalThis) -> Storage-like` (real `localStorage`, or memory fallback if it throws/is absent)
  - `createAuth({storage, api}) -> { login(username, password): Promise<Session>, getSession(): Session|null, logout(): void }` where `Session = {token, userid, fullname}`; storage key `aules.session`.

- [ ] **Step 1: Write the failing tests** `tests/auth.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage, getStorage } from '../src/storage.js';
import { createAuth } from '../src/auth.js';

const api = {
  requestToken: async () => 'tok',
  getSiteInfo: async () => ({ userid: 7, fullname: 'Ana Test' }),
};

test('login stores token/userid/fullname and never the password', async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  const session = await auth.login('10000001', 'S3cret&pass');
  assert.deepEqual(session, { token: 'tok', userid: 7, fullname: 'Ana Test' });
  assert.deepEqual(auth.getSession(), session);
  const raw = storage.getItem('aules.session');
  assert.ok(!raw.includes('S3cret'));
});

test('logout clears the session', async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  await auth.login('u', 'p');
  auth.logout();
  assert.equal(auth.getSession(), null);
  assert.equal(storage.getItem('aules.session'), null);
});

test('corrupt or incomplete stored session is treated as logged out', () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ storage, api });
  storage.setItem('aules.session', '{not json');
  assert.equal(auth.getSession(), null);
  storage.setItem('aules.session', JSON.stringify({ token: 'x' }));
  assert.equal(auth.getSession(), null);
});

test('failed login leaves no session', async () => {
  const storage = createMemoryStorage();
  const bad = { ...api, requestToken: async () => { throw Object.assign(new Error('x'), { code: 'invalidlogin' }); } };
  const auth = createAuth({ storage, api: bad });
  await assert.rejects(() => auth.login('u', 'p'));
  assert.equal(auth.getSession(), null);
});

test('getStorage falls back to memory when localStorage throws (Safari private mode)', () => {
  const win = { get localStorage() { throw new DOMException('denied', 'SecurityError'); } };
  const s = getStorage(win);
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
  const none = getStorage({});
  none.setItem('b', '2');
  assert.equal(none.getItem('b'), '2');
});

test('getStorage returns real localStorage when usable', () => {
  const store = new Map();
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(getStorage({ localStorage: fake }), fake);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

`src/storage.js`:
```js
export function createMemoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

export function getStorage(win = globalThis) {
  try {
    const s = win.localStorage;
    s.setItem('__probe', '1');
    s.removeItem('__probe');
    return s;
  } catch {
    return createMemoryStorage();
  }
}
```
`src/auth.js`:
```js
const KEY = 'aules.session';

export function createAuth({ storage, api }) {
  return {
    async login(username, password) {
      const token = await api.requestToken(username, password);
      const info = await api.getSiteInfo(token);
      const session = { token, userid: info.userid, fullname: info.fullname };
      storage.setItem(KEY, JSON.stringify(session));
      return session;
    },
    getSession() {
      try {
        const s = JSON.parse(storage.getItem(KEY));
        return s && s.token && s.userid != null ? s : null;
      } catch {
        return null;
      }
    },
    logout() {
      storage.removeItem(KEY);
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**, commit

```bash
git add -A && git commit -m "feat: storage fallback and auth"
```

---

### Task 3b: Encrypted credential vault + silent relogin

**Files:**
- Create: `src/vault.js`, `tests/vault.test.js`, `tests/auth-vault.test.js`
- Modify: `src/auth.js` (replace contents as below)

**Interfaces:**
- Consumes: Storage-like object; Web Crypto (`globalThis.crypto`, available in Node >= 20 and Safari); a key store `{get(): Promise<CryptoKey|null>, set(key): Promise<void>, clear?(): Promise<void>}`.
- Produces:
  - `createMemoryKeyStore()`, `createIdbKeyStore(idb = globalThis.indexedDB)` (browser; DB `aules-vault`, store `keys`, record `k`).
  - `createVault({storage, keyStore, crypto?}) -> { save(username, password): Promise<boolean>, load(): Promise<{username,password}|null>, clear(): Promise<void> }`. Storage key `aules.vault` holds `{iv, ct}` (base64). Never throws; failures mean `false`/`null`.
  - `createAuth({storage, api, vault?})` now also returns `relogin(): Promise<Session|null>` (null = nothing saved; rejects with the Moodle error otherwise; `invalidlogin` also wipes the vault). `login()` saves credentials to the vault after success; `logout()` returns a Promise that resolves once the vault is cleared.

- [ ] **Step 1: Write the failing vault tests** `tests/vault.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createVault, createMemoryKeyStore } from '../src/vault.js';

const PASS = 'p&ss=w+d%é';

test('save/load round-trips; storage holds only ciphertext', async () => {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  assert.equal(await vault.save('10000001', PASS), true);
  assert.deepEqual(await vault.load(), { username: '10000001', password: PASS });
  const raw = storage.getItem('aules.vault');
  assert.ok(!raw.includes('10000001') && !raw.includes('ss=w'));
  assert.ok(!raw.includes(Buffer.from(PASS).toString('base64')));
});

test('the key is non-extractable', async () => {
  const keyStore = createMemoryKeyStore();
  const vault = createVault({ storage: createMemoryStorage(), keyStore });
  await vault.save('u', 'p');
  const key = await keyStore.get();
  assert.equal(key.extractable, false);
  await assert.rejects(() => globalThis.crypto.subtle.exportKey('raw', key));
});

test('clear wipes ciphertext and key', async () => {
  const storage = createMemoryStorage();
  const keyStore = createMemoryKeyStore();
  const vault = createVault({ storage, keyStore });
  await vault.save('u', 'p');
  await vault.clear();
  assert.equal(storage.getItem('aules.vault'), null);
  assert.equal(await keyStore.get(), null);
  assert.equal(await vault.load(), null);
});

test('load returns null for missing key, tampered or corrupt data', async () => {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  assert.equal(await vault.load(), null);
  await vault.save('u', 'p');
  const rec = JSON.parse(storage.getItem('aules.vault'));
  rec.ct = rec.ct.slice(0, -4) + 'AAAA';
  storage.setItem('aules.vault', JSON.stringify(rec));
  assert.equal(await vault.load(), null);
  storage.setItem('aules.vault', '{oops');
  assert.equal(await vault.load(), null);
  const other = createVault({ storage, keyStore: createMemoryKeyStore() });
  await vault.save('u', 'p');
  assert.equal(await other.load(), null); // a different key cannot decrypt
});

test('unavailable key storage means nothing is saved and nothing throws', async () => {
  const storage = createMemoryStorage();
  const broken = { get: async () => { throw new Error('no idb'); }, set: async () => { throw new Error('no idb'); } };
  const vault = createVault({ storage, keyStore: broken });
  assert.equal(await vault.save('u', 'p'), false);
  assert.equal(storage.getItem('aules.vault'), null);
  assert.equal(await vault.load(), null);
  await assert.doesNotReject(() => vault.clear());
});
```

- [ ] **Step 2: Write the failing auth tests** `tests/auth-vault.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createVault, createMemoryKeyStore } from '../src/vault.js';
import { createAuth } from '../src/auth.js';

function setup(apiOverrides = {}) {
  const storage = createMemoryStorage();
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  let n = 0;
  const calls = [];
  const api = {
    requestToken: async (u, p) => { calls.push([u, p]); n += 1; return `tok${n}`; },
    getSiteInfo: async () => ({ userid: 7, fullname: 'Ana' }),
    ...apiOverrides,
  };
  return { storage, vault, api, calls, auth: createAuth({ storage, api, vault }) };
}

test('login saves credentials; relogin silently gets a fresh token', async () => {
  const { auth, calls } = setup();
  await auth.login('10000001', 'S3cret&pass');
  assert.equal(auth.getSession().token, 'tok1');
  const fresh = await auth.relogin();
  assert.equal(fresh.token, 'tok2');
  assert.equal(auth.getSession().token, 'tok2');
  assert.deepEqual(calls[1], ['10000001', 'S3cret&pass']);
});

test('the session record never contains the password', async () => {
  const { auth, storage } = setup();
  await auth.login('u', 'S3cret&pass');
  assert.ok(!storage.getItem('aules.session').includes('S3cret'));
});

test('relogin returns null with no vault or nothing saved', async () => {
  const { storage, api } = setup();
  assert.equal(await createAuth({ storage, api }).relogin(), null);
  const { auth } = setup();
  assert.equal(await auth.relogin(), null);
});

test('rejected saved password wipes the vault and rejects', async () => {
  let reject = false;
  const { auth, vault } = setup({
    requestToken: async () => { if (reject) throw Object.assign(new Error('x'), { code: 'invalidlogin' }); return 'tok'; },
  });
  await auth.login('u', 'p');
  reject = true;
  await assert.rejects(() => auth.relogin(), (e) => e.code === 'invalidlogin');
  assert.equal(await vault.load(), null);
});

test('network failure during relogin keeps the saved credentials', async () => {
  let down = false;
  const { auth, vault } = setup({
    requestToken: async () => { if (down) throw Object.assign(new Error('x'), { code: 'network' }); return 'tok'; },
  });
  await auth.login('u', 'p');
  down = true;
  await assert.rejects(() => auth.relogin(), (e) => e.code === 'network');
  assert.deepEqual(await vault.load(), { username: 'u', password: 'p' });
});

test('logout clears session and vault', async () => {
  const { auth, vault } = setup();
  await auth.login('u', 'p');
  await auth.logout();
  assert.equal(auth.getSession(), null);
  assert.equal(await vault.load(), null);
});
```

- [ ] **Step 3: Run, expect FAIL** (`../src/vault.js` missing).

- [ ] **Step 4: Implement** `src/vault.js`

```js
const KEY = 'aules.vault';

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createMemoryKeyStore() {
  let key = null;
  return {
    get: async () => key,
    set: async (k) => { key = k; },
    clear: async () => { key = null; },
  };
}

export function createIdbKeyStore(idb = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const r = idb.open('aules-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => { db.close(); resolve(req.result ?? null); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: () => run('readonly', (s) => s.get('k')),
    set: (key) => run('readwrite', (s) => s.put(key, 'k')),
    clear: () => run('readwrite', (s) => s.delete('k')),
  };
}

export function createVault({ storage, keyStore, crypto = globalThis.crypto }) {
  async function getKey(create) {
    let key = await keyStore.get();
    if (!key && create) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await keyStore.set(key);
    }
    return key || null;
  }
  return {
    async save(username, password) {
      try {
        const key = await getKey(true);
        if (!key) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = new TextEncoder().encode(JSON.stringify({ username, password }));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
        storage.setItem(KEY, JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
        return true;
      } catch {
        return false;
      }
    },
    async load() {
      try {
        const rec = JSON.parse(storage.getItem(KEY));
        const key = await getKey(false);
        if (!rec || !key) return null;
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
        const c = JSON.parse(new TextDecoder().decode(plain));
        return c.username && c.password ? { username: c.username, password: c.password } : null;
      } catch {
        return null;
      }
    },
    async clear() {
      storage.removeItem(KEY);
      try { if (keyStore.clear) await keyStore.clear(); } catch { /* nothing to wipe */ }
    },
  };
}
```

Replace `src/auth.js`:
```js
const KEY = 'aules.session';

export function createAuth({ storage, api, vault = null }) {
  async function establish(username, password) {
    const token = await api.requestToken(username, password);
    const info = await api.getSiteInfo(token);
    const session = { token, userid: info.userid, fullname: info.fullname };
    storage.setItem(KEY, JSON.stringify(session));
    return session;
  }
  return {
    async login(username, password) {
      const session = await establish(username, password);
      if (vault) await vault.save(username, password);
      return session;
    },
    // Silent token renewal from the saved credentials. null = nothing saved.
    async relogin() {
      if (!vault) return null;
      const creds = await vault.load();
      if (!creds) return null;
      try {
        return await establish(creds.username, creds.password);
      } catch (err) {
        if (err && err.code === 'invalidlogin') await vault.clear();
        throw err;
      }
    },
    getSession() {
      try {
        const s = JSON.parse(storage.getItem(KEY));
        return s && s.token && s.userid != null ? s : null;
      } catch {
        return null;
      }
    },
    logout() {
      storage.removeItem(KEY);
      return vault ? vault.clear() : Promise.resolve();
    },
  };
}
```

- [ ] **Step 5: Run `npm test`, expect PASS** (Task 3's auth tests still pass: `vault` is optional). Commit:

```bash
git add -A && git commit -m "feat: encrypted credential vault and silent relogin"
```

---

### Task 4: Response cache

**Files:**
- Create: `src/store.js`, `tests/store.test.js`

**Interfaces:**
- Consumes: Storage-like object.
- Produces: `createCache(storage) -> { get(key): {data, savedAt}|null, set(key, data): void, clear(): void }`. Keys are namespaced `aules.cache.<key>` with an index key `aules.cache.__index` so `clear()` needs no key enumeration. `set` swallows quota errors.

- [ ] **Step 1: Write the failing tests** `tests/store.test.js`

```js
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
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/store.js`

```js
const P = 'aules.cache.';
const INDEX = P + '__index';

export function createCache(storage) {
  const readIndex = () => {
    try { return JSON.parse(storage.getItem(INDEX)) || []; } catch { return []; }
  };
  return {
    get(key) {
      try { return JSON.parse(storage.getItem(P + key)); } catch { return null; }
    },
    set(key, data) {
      try {
        storage.setItem(P + key, JSON.stringify({ data, savedAt: Date.now() }));
        const idx = readIndex();
        if (!idx.includes(key)) storage.setItem(INDEX, JSON.stringify([...idx, key]));
      } catch { /* quota or storage unavailable: caching is best-effort */ }
    },
    clear() {
      for (const key of readIndex()) storage.removeItem(P + key);
      storage.removeItem(INDEX);
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**, commit

```bash
git add -A && git commit -m "feat: response cache"
```

---

### Task 5: HTML sanitizer

**Files:**
- Create: `src/sanitize.js`, `tests/helpers/dom.js`, `tests/sanitize.test.js`

**Interfaces:**
- Produces:
  - `sanitizeHtml(html: string, opts?: {rewriteUrl?: (url)=>string, DOMParserCtor?}) -> string` — allow-list; `rewriteUrl` is applied to surviving `href`/`src` values.
  - `isSafeHttpUrl(url: string) -> boolean` — true only for absolute `http:`/`https:` URLs.
  - test helper `setupDom() -> JSDOM` sets `globalThis.window`, `document`, `DOMParser`.

- [ ] **Step 1: Write the test helper** `tests/helpers/dom.js`

```js
import { JSDOM } from 'jsdom';

export function setupDom(html = '<!doctype html><html><body><div id="app"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'https://app.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  return dom;
}
```

- [ ] **Step 2: Write the failing tests** `tests/sanitize.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sanitizeHtml, isSafeHttpUrl } from '../src/sanitize.js';

setupDom();

test('keeps safe formatting', () => {
  assert.equal(sanitizeHtml('<p>Hi <strong>there</strong></p>'), '<p>Hi <strong>there</strong></p>');
});

test('drops script/style/svg/iframe/form content entirely', () => {
  const out = sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><svg onload="x()"><circle/></svg><iframe src="https://e.com"></iframe><form><input></form>');
  assert.equal(out, '<p>a</p>');
});

test('strips event handlers and style attributes', () => {
  const out = sanitizeHtml('<p style="color:red" onclick="x()">a</p><img src="https://e.com/i.png" onerror="alert(1)">');
  assert.ok(!/onclick|onerror|style=/i.test(out));
  assert.ok(out.includes('<img'));
});

test('removes javascript: URLs including tab-obfuscated ones, keeps link text', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">one</a><a href="jav&#x09;ascript:alert(2)">two</a>');
  assert.ok(!/javascript/i.test(out));
  assert.ok(out.includes('one') && out.includes('two'));
});

test('drops data: image sources but keeps https ones', () => {
  const out = sanitizeHtml('<img src="data:image/svg+xml;base64,AAAA"><img src="https://e.com/a.png">');
  assert.ok(!out.includes('data:'));
  assert.ok(out.includes('https://e.com/a.png'));
});

test('unknown wrapper tags are unwrapped, comments removed', () => {
  assert.equal(sanitizeHtml('<font color="red">text</font><!-- c -->'), 'text');
});

test('links open safely in a new tab', () => {
  const out = sanitizeHtml('<a href="https://e.com/x">x</a>');
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('rewriteUrl is applied to surviving href and src only', () => {
  const out = sanitizeHtml('<a href="https://e.com/a">a</a><img src="https://e.com/i.png"><a href="javascript:x">b</a>', {
    rewriteUrl: (u) => u + '?T=1',
  });
  assert.ok(out.includes('href="https://e.com/a?T=1"'));
  assert.ok(out.includes('src="https://e.com/i.png?T=1"'));
});

test('isSafeHttpUrl accepts only absolute http(s)', () => {
  assert.equal(isSafeHttpUrl('https://a.com/x'), true);
  assert.equal(isSafeHttpUrl('http://a.com'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('/relative'), false);
  assert.equal(isSafeHttpUrl('data:text/html,x'), false);
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl(undefined), false);
});
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement** `src/sanitize.js`

```js
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'link', 'meta', 'base', 'noscript', 'template', 'audio', 'video', 'input', 'button', 'textarea', 'select']);
const KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'hr', 'sub', 'sup', 'figure', 'figcaption']);
const ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };

export function isSafeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeLink(url) {
  try {
    const p = new URL(url, 'https://base.invalid').protocol;
    return p === 'http:' || p === 'https:' || p === 'mailto:';
  } catch {
    return false;
  }
}

function cleanAttrs(el, tag, rewriteUrl) {
  const allowed = ATTRS[tag] || [];
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.includes(attr.name)) el.removeAttribute(attr.name);
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    const v = el.getAttribute('href');
    if (isSafeLink(v)) el.setAttribute('href', rewriteUrl ? rewriteUrl(v) : v);
    else el.removeAttribute('href');
  }
  if (tag === 'img' && el.hasAttribute('src')) {
    const v = el.getAttribute('src');
    if (isSafeLink(v) && !v.trim().toLowerCase().startsWith('mailto:')) el.setAttribute('src', rewriteUrl ? rewriteUrl(v) : v);
    else el.removeAttribute('src');
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function clean(node, rewriteUrl) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
    const tag = child.localName;
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child, rewriteUrl);
    if (KEEP.has(tag)) {
      cleanAttrs(child, tag, rewriteUrl);
    } else {
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
    }
  }
}

export function sanitizeHtml(html, { rewriteUrl, DOMParserCtor } = {}) {
  const Parser = DOMParserCtor || globalThis.DOMParser;
  const doc = new Parser().parseFromString(String(html || ''), 'text/html');
  clean(doc.body, rewriteUrl);
  return doc.body.innerHTML;
}
```

- [ ] **Step 5: Run, expect PASS.** If the `jav&#x09;ascript` case fails, check how jsdom exposes the decoded attribute and fix `isSafeLink` (the WHATWG URL parser strips tabs/newlines, which is what makes this test pass).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: allow-list HTML sanitizer"
```

---

### Task 6: Content model (token URLs, course view-model)

**Files:**
- Create: `src/content.js`, `tests/fixtures.js`, `tests/content.test.js`

**Interfaces:**
- Consumes: `SITE_URL`, `STRINGS.section`, `isSafeHttpUrl`.
- Produces:
  - `withToken(url, token) -> string` — adds/overwrites `token` query param **only** for `https://aules.edu.gva.es` URLs whose path contains `/pluginfile.php`; otherwise returns `url` unchanged.
  - `buildCourse(sections, token) -> ViewSection[]` where
    `ViewSection = {id, name, summary: string(html), modules: ViewModule[]}` and
    `ViewModule = {id, name, kind: 'label'|'file'|'folder'|'page'|'url'|'other', description: string(html), links: {label, href, external?}[], unsupported?: true}`.
    Hidden modules (`uservisible === false`) are dropped; sections with no modules and an empty summary are dropped; blank section names become `"Section <section>"`.
  - `tests/fixtures.js` exports `sampleCourses`, `sampleSections` (shared with preview).

- [ ] **Step 1: Write fixtures** `tests/fixtures.js`

```js
const F = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php';

export const sampleCourses = [
  { id: 11, fullname: 'Programació', shortname: 'PRG', progress: 40, overviewfiles: [{ fileurl: `${F}/1/course/overviewfiles/prg.png` }] },
  { id: 12, fullname: 'Sistemes informàtics', shortname: 'SI', progress: null, overviewfiles: [] },
];

export const sampleSections = [
  {
    id: 100, section: 0, name: 'General', summary: '', modules: [
      { id: 1, name: 'Welcome', modname: 'label', uservisible: true, description: '<p>Welcome to the <strong>course</strong>.</p><script>alert(1)</script>' },
      { id: 2, name: 'Syllabus', modname: 'resource', uservisible: true, contents: [{ type: 'file', filename: 'syllabus.pdf', fileurl: `${F}/5/mod_resource/content/1/syllabus.pdf?forcedownload=1` }] },
    ],
  },
  {
    id: 101, section: 1, name: '', summary: '<p>Unit 1 overview</p>', modules: [
      { id: 3, name: 'Docs site', modname: 'url', uservisible: true, contents: [{ type: 'url', fileurl: 'https://example.org/docs' }] },
      { id: 4, name: 'Exercises', modname: 'folder', uservisible: true, contents: [
        { type: 'file', filename: 'ex1.pdf', fileurl: `${F}/6/mod_folder/content/0/ex1.pdf` },
        { type: 'file', filename: 'ex2.pdf', fileurl: `${F}/6/mod_folder/content/0/ex2.pdf` },
      ] },
      { id: 5, name: 'Reading', modname: 'page', uservisible: true, contents: [{ type: 'file', filename: 'index.html', fileurl: `${F}/7/mod_page/content/index.html` }] },
      { id: 6, name: 'Secret', modname: 'resource', uservisible: false, contents: [] },
      { id: 7, name: 'Questions', modname: 'forum', uservisible: true },
    ],
  },
  { id: 102, section: 2, name: 'Empty', summary: '', modules: [] },
];
```

- [ ] **Step 2: Write the failing tests** `tests/content.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { withToken, buildCourse } from '../src/content.js';
import { sampleSections } from './fixtures.js';

const F = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php';

test('withToken uses ? or & correctly and only for aules pluginfile URLs', () => {
  assert.equal(withToken(`${F}/1/a.png`, 'T'), `${F}/1/a.png?token=T`);
  assert.equal(withToken(`${F}/1/a.pdf?forcedownload=1`, 'T'), `${F}/1/a.pdf?forcedownload=1&token=T`);
  assert.equal(withToken(`${F}/1/a.pdf?token=old`, 'T'), `${F}/1/a.pdf?token=T`);
});

test('withToken never leaks the token to other hosts or other aules paths', () => {
  assert.equal(withToken('https://evil.example/pluginfile.php/x', 'T'), 'https://evil.example/pluginfile.php/x');
  assert.equal(withToken('https://aules.edu.gva.es.evil.example/fpa/pluginfile.php/x', 'T'), 'https://aules.edu.gva.es.evil.example/fpa/pluginfile.php/x');
  assert.equal(withToken('https://aules.edu.gva.es/fpa/course/view.php?id=1', 'T'), 'https://aules.edu.gva.es/fpa/course/view.php?id=1');
  assert.equal(withToken('not a url', 'T'), 'not a url');
});

test('buildCourse drops hidden modules and empty sections, names blank sections', () => {
  const v = buildCourse(sampleSections, 'T');
  assert.equal(v.length, 2);
  assert.equal(v[0].name, 'General');
  assert.equal(v[1].name, 'Section 1');
  assert.equal(v[1].modules.some((m) => m.name === 'Secret'), false);
});

test('module kinds and links', () => {
  const [general, unit] = buildCourse(sampleSections, 'T');
  const label = general.modules[0];
  assert.equal(label.kind, 'label');
  assert.equal(label.name, '');
  const file = general.modules[1];
  assert.equal(file.kind, 'file');
  assert.equal(file.links[0].label, 'syllabus.pdf');
  assert.equal(file.links[0].href, `${F}/5/mod_resource/content/1/syllabus.pdf?forcedownload=1&token=T`);

  const [url, folder, page, forum] = unit.modules;
  assert.deepEqual(url.links, [{ label: 'Docs site', href: 'https://example.org/docs', external: true }]);
  assert.equal(folder.links.length, 2);
  assert.equal(page.kind, 'page');
  assert.deepEqual(page.links, [{ label: 'Reading', href: `${F}/7/mod_page/content/index.html?token=T` }]);
  assert.equal(forum.kind, 'other');
  assert.equal(forum.unsupported, true);
  assert.deepEqual(forum.links, []);
});

test('javascript: url modules produce no link; missing arrays are tolerated', () => {
  const v = buildCourse([
    { id: 1, section: 0, name: 'S', summary: '', modules: [{ id: 9, name: 'Bad', modname: 'url', contents: [{ type: 'url', fileurl: 'javascript:alert(1)' }] }, { id: 10, name: 'NoContents', modname: 'resource' }] },
    { id: 2, section: 1, name: 'T' },
  ], 'T');
  assert.deepEqual(v[0].modules[0].links, []);
  assert.deepEqual(v[0].modules[1].links, []);
  assert.equal(v.length, 1);
  assert.deepEqual(buildCourse(undefined, 'T'), []);
});

test('sections with only a summary are kept; whitespace/nbsp-only summaries are not', () => {
  const v = buildCourse([
    { id: 1, section: 0, name: 'A', summary: '<p>Real</p>', modules: [] },
    { id: 2, section: 1, name: 'B', summary: '<p>&nbsp; </p>', modules: [] },
  ], 'T');
  assert.deepEqual(v.map((s) => s.name), ['A']);
});
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement** `src/content.js`

```js
import { SITE_URL } from './config.js';
import { STRINGS as S } from './strings.js';
import { isSafeHttpUrl } from './sanitize.js';

const ORIGIN = new URL(SITE_URL).origin;

export function withToken(url, token) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.origin !== ORIGIN || !u.pathname.includes('/pluginfile.php')) return url;
  u.searchParams.set('token', token);
  return u.toString();
}

const hasText = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';

function fileLinks(files, token, labelOf) {
  return files
    .map((f) => ({ label: labelOf(f), href: withToken(f.fileurl, token) }))
    .filter((l) => isSafeHttpUrl(l.href));
}

function buildModule(m, token) {
  const base = { id: m.id, name: m.name || '', description: m.description || '', links: [] };
  const files = (m.contents || []).filter((c) => c.type === 'file');
  switch (m.modname) {
    case 'label':
      return { ...base, kind: 'label', name: '' };
    case 'resource':
      return { ...base, kind: 'file', links: fileLinks(files, token, (f) => f.filename) };
    case 'folder':
      return { ...base, kind: 'folder', links: fileLinks(files, token, (f) => f.filename) };
    case 'page':
      return { ...base, kind: 'page', links: fileLinks(files.slice(0, 1), token, () => base.name) };
    case 'url': {
      const u = (m.contents || []).find((c) => c.type === 'url');
      const links = u && isSafeHttpUrl(u.fileurl) ? [{ label: base.name, href: u.fileurl, external: true }] : [];
      return { ...base, kind: 'url', links };
    }
    default:
      return { ...base, kind: 'other', unsupported: true };
  }
}

export function buildCourse(sections, token) {
  return (sections || [])
    .map((s, i) => ({
      id: s.id,
      name: (s.name || '').trim() || `${S.section} ${s.section ?? i}`,
      summary: s.summary || '',
      modules: (s.modules || []).filter((m) => m.uservisible !== false).map((m) => buildModule(m, token)),
    }))
    .filter((s) => s.modules.length || hasText(s.summary));
}
```

- [ ] **Step 5: Run, expect PASS**, commit

```bash
git add -A && git commit -m "feat: content model with token-safe file URLs"
```

---

### Task 7: UI components + styles

**Files:**
- Create: `src/ui/dom.js`, `src/ui/login.js`, `src/ui/courses.js`, `src/ui/course.js`, `src/styles.css`, `tests/ui.test.js`

**Interfaces:**
- Consumes: `STRINGS`, `describeError`, `withToken`, `sanitizeHtml`, `isSafeHttpUrl`.
- Produces:
  - `h(tag, attrs?, ...children) -> HTMLElement`; `clear(el) -> el` (attrs: `class`, `onxxx` functions, `null/false` skipped, `true` -> empty attribute).
  - `renderLogin({onSubmit(username, password): Promise<void>, message?}) -> HTMLElement` (shows `describeError(err)` when `onSubmit` rejects; clears the password field after each attempt).
  - `renderCourseList({courses, token, selectedId}) -> HTMLElement` (search input filters via `hidden`; cards are `<a href="#/course/ID">`).
  - `renderCourse({course:{id, fullname, sections: ViewSection[]}, token, offline?}) -> HTMLElement`; `renderBack() -> HTMLAnchorElement` (`href="#/"`).

- [ ] **Step 1: Write the failing tests** `tests/ui.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections } from './fixtures.js';
import { buildCourse } from '../src/content.js';
import { MoodleError } from '../src/api.js';

setupDom();
const { renderLogin } = await import('../src/ui/login.js');
const { renderCourseList } = await import('../src/ui/courses.js');
const { renderCourse } = await import('../src/ui/course.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

test('login submits trimmed user + raw password, then clears the password', async () => {
  const seen = [];
  const el = renderLogin({ onSubmit: async (u, p) => { seen.push([u, p]); } });
  document.body.append(el);
  el.querySelector('[name=username]').value = '  10000001 ';
  el.querySelector('[name=password]').value = ' pa ss ';
  el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(seen, [['10000001', ' pa ss ']]);
  assert.equal(el.querySelector('[name=password]').value, '');
  el.remove();
});

test('login shows a friendly message when submit fails and re-enables the button', async () => {
  const el = renderLogin({ onSubmit: async () => { throw new MoodleError('invalidlogin'); } });
  document.body.append(el);
  el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  assert.match(el.querySelector('.form-msg').textContent, /Wrong user number/);
  assert.equal(el.querySelector('button').disabled, false);
  el.remove();
});

test('course list renders cards, token on image, selection and search filter', () => {
  const el = renderCourseList({ courses: sampleCourses, token: 'T', selectedId: 12 });
  const cards = el.querySelectorAll('a.card');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].getAttribute('href'), '#/course/11');
  assert.match(cards[0].querySelector('img').src, /token=T/);
  assert.equal(cards[0].querySelector('progress').value, 40);
  assert.equal(cards[1].querySelector('img'), null);
  assert.equal(cards[1].getAttribute('aria-current'), 'page');

  const search = el.querySelector('input[type=search]');
  search.value = 'sistemes';
  search.dispatchEvent(new window.Event('input'));
  const items = el.querySelectorAll('li');
  assert.equal(items[0].hidden, true);
  assert.equal(items[1].hidden, false);
  search.value = 'zzz';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(el.querySelector('.status').hidden, false);
});

test('empty course list shows the empty message', () => {
  const el = renderCourseList({ courses: [], token: 'T' });
  assert.equal(el.querySelector('.status').hidden, false);
});

test('course view: sections, safe label html, token on file links, first section open', () => {
  const sections = buildCourse(sampleSections, 'T');
  const el = renderCourse({ course: { id: 11, fullname: 'Programació', sections }, token: 'T' });
  assert.equal(el.querySelector('h2').textContent, 'Programació');
  const details = el.querySelectorAll('details');
  assert.equal(details.length, 2);
  assert.equal(details[0].open, true);
  assert.equal(details[1].open, false);
  assert.equal(el.querySelector('script'), null);
  assert.match(el.querySelector('.label').innerHTML, /<strong>course<\/strong>/);
  const link = el.querySelector('a[href*="syllabus.pdf"]');
  assert.match(link.getAttribute('href'), /token=T/);
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.ok(el.textContent.includes('Not available in this app yet'));
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/');
});

test('course view with no sections and offline banner', () => {
  const el = renderCourse({ course: { id: 1, fullname: 'X', sections: [] }, token: 'T', offline: true });
  assert.ok(el.textContent.includes('This course has no content'));
  assert.ok(el.querySelector('.banner'));
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/ui/dom.js`

```js
export function h(tag, attrs = {}, ...children) {
  const el = globalThis.document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}
```

`src/ui/login.js`:
```js
import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';

export function renderLogin({ onSubmit, message = '' }) {
  const user = h('input', { id: 'user', name: 'username', type: 'text', inputmode: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', required: true });
  const pass = h('input', { id: 'pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'form-msg', role: 'alert' }, message);
  const btn = h('button', { type: 'submit', class: 'btn' }, S.signIn);
  const form = h('form', {
    class: 'login-card',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.textContent = '';
      try {
        await onSubmit(user.value.trim(), pass.value);
      } catch (err) {
        msg.textContent = describeError(err);
      } finally {
        btn.disabled = false;
        pass.value = '';
      }
    },
  },
  h('h1', {}, S.appName),
  h('label', { for: 'user' }, S.username), user,
  h('label', { for: 'pass' }, S.password), pass,
  msg, h('p', { class: 'muted' }, S.saveNote), btn);
  return h('div', { class: 'login' }, form);
}
```

`src/ui/courses.js`:
```js
import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { isSafeHttpUrl } from '../sanitize.js';

function card(c, token, selectedId) {
  const raw = c.overviewfiles && c.overviewfiles[0] && c.overviewfiles[0].fileurl;
  const img = raw && withToken(raw, token);
  const li = h('li', { 'data-text': `${c.fullname} ${c.shortname || ''}`.toLowerCase() },
    h('a', { class: 'card', href: `#/course/${c.id}`, 'aria-current': c.id === selectedId ? 'page' : null },
      img && isSafeHttpUrl(img) ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb', 'aria-hidden': 'true' }),
      h('span', { class: 'meta' }, h('strong', {}, c.fullname), h('small', {}, c.shortname || '')),
      typeof c.progress === 'number' ? h('progress', { max: 100, value: Math.round(c.progress) }) : null));
  return li;
}

export function renderCourseList({ courses, token, selectedId }) {
  const list = h('ul', { class: 'cards' }, courses.map((c) => card(c, token, selectedId)));
  const empty = h('p', { class: 'status' }, S.empty);
  empty.hidden = courses.length > 0;
  const search = h('input', {
    type: 'search', class: 'search', placeholder: S.search, 'aria-label': S.search,
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const li of list.children) {
        const hit = !q || li.dataset.text.includes(q);
        li.hidden = !hit;
        if (hit) shown += 1;
      }
      empty.hidden = shown > 0;
    },
  });
  return h('div', { class: 'courses' }, search, empty, list);
}
```

`src/ui/course.js`:
```js
import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { sanitizeHtml } from '../sanitize.js';

export function renderBack() {
  return h('a', { class: 'back', href: '#/' }, '‹ ', S.back);
}

function html(cls, raw, opts) {
  const d = h('div', { class: cls });
  d.innerHTML = sanitizeHtml(raw, opts);
  return d;
}

function renderModule(m, opts) {
  if (m.kind === 'label') return h('li', { class: 'mod label' }, html('html', m.description, opts));
  const linkOnly = (m.kind === 'url' || m.kind === 'page') && m.links.length > 0;
  return h('li', { class: `mod ${m.kind}` },
    linkOnly ? null : h('span', { class: 'mod-name' }, m.name),
    m.unsupported ? h('small', { class: 'muted' }, S.unsupported) : null,
    m.description ? html('html small', m.description, opts) : null,
    m.links.length
      ? h('ul', { class: 'links' }, m.links.map((l) => h('li', {}, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label))))
      : null);
}

function renderSection(s, open, opts) {
  return h('details', { class: 'section', open },
    h('summary', {}, s.name),
    s.summary ? html('html', s.summary, opts) : null,
    h('ul', { class: 'modules' }, s.modules.map((m) => renderModule(m, opts))));
}

export function renderCourse({ course, token, offline }) {
  const opts = { rewriteUrl: (u) => withToken(u, token) };
  const firstOpen = course.sections.findIndex((s) => s.modules.length);
  const body = course.sections.length
    ? course.sections.map((s, i) => renderSection(s, i === firstOpen, opts))
    : h('p', { class: 'status' }, S.noContent);
  return h('article', { class: 'course' },
    h('header', { class: 'bar' }, renderBack(), h('h2', {}, course.fullname)),
    offline ? h('p', { class: 'banner' }, S.offline) : null,
    body);
}
```

- [ ] **Step 4: Write `src/styles.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #f4f6f9; --surface: #fff; --text: #18202b; --muted: #5d6b7c;
  --accent: #1b5fa8; --on-accent: #fff; --border: #dbe1e8; --danger: #b3261e; --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f141a; --surface: #18202b; --text: #e8edf3; --muted: #95a3b4; --accent: #6aa9ec; --on-accent: #0b1520; --border: #2a3441; --danger: #f2b8b5; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; min-height: 100%; }
body { font: 16px/1.45 -apple-system, system-ui, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); -webkit-text-size-adjust: 100%; }
#app { min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
a { color: var(--accent); }
h1, h2 { margin: 0; line-height: 1.2; }

/* Login */
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login-card { width: min(100%, 420px); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; display: grid; gap: 8px; }
.login-card label { font-size: 14px; color: var(--muted); margin-top: 8px; }
input { font: inherit; font-size: 16px; /* 16px stops iOS zoom-on-focus */ min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); width: 100%; }
.btn { font: inherit; min-height: 48px; margin-top: 12px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; }
.btn:disabled { opacity: .6; }
.form-msg { min-height: 1.4em; margin: 4px 0 0; color: var(--danger); }
.link { font: inherit; background: none; border: 0; color: var(--accent); min-height: 44px; padding: 0 8px; }

/* Shell */
.bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; position: sticky; top: 0; background: var(--bg); z-index: 1; }
.bar h1, .bar h2 { flex: 1; font-size: 20px; }
.back { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; font-weight: 600; }
.status, .placeholder { color: var(--muted); padding: 16px; text-align: center; }
.banner { margin: 0 16px 8px; padding: 8px 12px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 14px; }
.error { color: var(--danger); padding: 16px; }
.search { margin: 0 16px 8px; width: calc(100% - 32px); }

/* Course cards */
.cards { list-style: none; margin: 0; padding: 0 16px 16px; display: grid; gap: 10px; }
.card { display: grid; grid-template-columns: 64px 1fr; grid-template-rows: auto auto; gap: 2px 12px; align-items: center; padding: 10px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); color: inherit; text-decoration: none; min-height: 64px; }
.card[aria-current="page"] { border-color: var(--accent); }
.card img, .card .thumb { grid-row: 1 / 3; width: 64px; height: 64px; border-radius: 10px; object-fit: cover; background: var(--accent); opacity: .9; }
.card .meta { display: grid; }
.card small { color: var(--muted); }
.card progress { grid-column: 2; width: 100%; height: 6px; }

/* Course content */
.section { margin: 0 16px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.section > summary { padding: 14px 16px; font-weight: 600; min-height: 48px; cursor: pointer; }
.section > .html { padding: 0 16px; }
.modules { list-style: none; margin: 0; padding: 0 16px 8px; }
.mod { padding: 10px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
.mod img, .html img { max-width: 100%; height: auto; }
.mod-name { font-weight: 600; display: block; }
.links { list-style: none; margin: 4px 0 0; padding: 0; }
.links a { display: inline-block; padding: 8px 0; min-height: 44px; }
.muted, .small { color: var(--muted); font-size: 14px; }
table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
td, th { border: 1px solid var(--border); padding: 4px 8px; }

/* Phone: one pane at a time */
@media (max-width: 767px) {
  .shell .pane-detail { display: none; }
  .shell.has-detail .pane-list { display: none; }
  .shell.has-detail .pane-detail { display: block; }
}
/* iPad and wider: master/detail */
@media (min-width: 768px) {
  .shell { display: grid; grid-template-columns: minmax(300px, 360px) 1fr; height: 100vh; }
  .pane-list, .pane-detail { overflow: auto; -webkit-overflow-scrolling: touch; }
  .pane-list { border-right: 1px solid var(--border); }
  .back { display: none; }
}
```

- [ ] **Step 5: Run `npm test`, expect PASS**, commit

```bash
git add -A && git commit -m "feat: UI components and styles"
```

---

### Task 8: App wiring, entry point, preview harness

**Files:**
- Create: `src/app.js`, `src/main.js`, `index.html`, `tools/serve.mjs`, `tools/preview.html`, `tools/preview.js`, `tests/app.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `createApp({root, api, auth, cache, win?}) -> { start(): Promise<void>, login(u, p): Promise<void>, logout(message?): void, showRoute(): Promise<void> }`. `api` = module namespace of `api.js` (or fake with the same four functions). Routes: `#/` (course list) and `#/course/<id>`. `invalidtoken` from any call -> logout with expired message. Network failure -> cached data + offline banner when cached, else error text.

- [ ] **Step 1: Write the failing tests** `tests/app.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections } from './fixtures.js';
import { MoodleError } from '../src/api.js';
import { createMemoryStorage } from '../src/storage.js';

const { createApp } = await import('../src/app.js');
const { createAuth } = await import('../src/auth.js');
const { createCache } = await import('../src/store.js');
const { createVault, createMemoryKeyStore } = await import('../src/vault.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(apiOverrides = {}, preloadSession = false) {
  const dom = setupDom();
  const storage = createMemoryStorage();
  const api = {
    requestToken: async () => 'tok',
    getSiteInfo: async () => ({ userid: 7, fullname: 'Ana' }),
    getCourses: async () => sampleCourses,
    getCourseContents: async () => sampleSections,
    ...apiOverrides,
  };
  const vault = createVault({ storage, keyStore: createMemoryKeyStore() });
  const auth = createAuth({ storage, api, vault });
  const cache = createCache(storage);
  if (preloadSession) storage.setItem('aules.session', JSON.stringify({ token: 'tok', userid: 7, fullname: 'Ana' }));
  const root = document.getElementById('app');
  const app = createApp({ root, api, auth, cache, win: dom.window });
  return { app, root, storage, auth, cache, vault, api, win: dom.window };
}

test('no session -> login screen', async () => {
  const { app, root } = setup();
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
});

test('login shows the course list', async () => {
  const { app, root, storage } = setup();
  await app.start();
  await app.login('10000001', 'x');
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(storage.getItem('aules.session'));
});

test('failed login rejects (login form shows the message) and stays on login', async () => {
  const { app, root } = setup({ requestToken: async () => { throw new MoodleError('invalidlogin'); } });
  await app.start();
  await assert.rejects(() => app.login('u', 'p'));
  assert.ok(root.querySelector('form.login-card'));
});

test('opening a course renders its content and marks the shell as has-detail', async () => {
  const { app, root, win } = setup({}, true);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.ok(root.querySelector('.shell.has-detail'));
  assert.ok(root.querySelector('.pane-detail details'));
  assert.equal(root.querySelector('.pane-detail h2').textContent, 'Programació');
});

test('invalid token on course list -> back to login with expiry message', async () => {
  const { app, root, storage } = setup({ getCourses: async () => { throw new MoodleError('invalidtoken'); } }, true);
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
  assert.match(root.querySelector('.form-msg').textContent, /session expired/i);
  assert.equal(storage.getItem('aules.session'), null);
});

test('offline with cached courses -> cards plus offline banner', async () => {
  const { app, root, cache } = setup({ getCourses: async () => { throw new MoodleError('network'); } }, true);
  cache.set('courses', sampleCourses);
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(root.querySelector('.banner'));
});

test('offline with nothing cached -> error message and retry', async () => {
  const { app, root } = setup({ getCourses: async () => { throw new MoodleError('network'); } }, true);
  await app.start();
  assert.match(root.textContent, /Cannot reach Aules/);
  assert.ok(root.querySelector('button.retry'));
});

test('course contents failing offline falls back to cached contents', async () => {
  const { app, root, cache, win } = setup({ getCourseContents: async () => { throw new MoodleError('network'); } }, true);
  cache.set('course:11', sampleSections);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.ok(root.querySelector('.pane-detail details'));
  assert.ok(root.querySelector('.pane-detail .banner'));
});

test('logout clears session, saved credentials and cached data and returns to login', async () => {
  const { app, root, storage, cache, vault } = setup({}, true);
  await vault.save('u', 'p');
  await app.start();
  assert.ok(cache.get('courses'));
  app.logout();
  await tick();
  assert.ok(root.querySelector('form.login-card'));
  assert.equal(storage.getItem('aules.session'), null);
  assert.equal(cache.get('courses'), null);
  assert.equal(await vault.load(), null);
});

test('expired token with saved credentials is renewed silently (no login screen)', async () => {
  let first = true;
  const tokens = [];
  const { app, root, vault, auth } = setup({
    getCourses: async (token) => {
      tokens.push(token);
      if (first) { first = false; throw new MoodleError('invalidtoken'); }
      return sampleCourses;
    },
    requestToken: async () => 'fresh-token',
  }, true);
  await vault.save('10000001', 'pw');
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.equal(root.querySelector('form.login-card'), null);
  assert.deepEqual(tokens, ['tok', 'fresh-token']);
  assert.equal(auth.getSession().token, 'fresh-token');
});

test('renewal is retried only once: a second invalidtoken ends at login', async () => {
  let calls = 0;
  const { app, root, vault } = setup({
    getCourses: async () => { calls += 1; throw new MoodleError('invalidtoken'); },
  }, true);
  await vault.save('u', 'pw');
  await app.start();
  assert.equal(calls, 2);
  assert.ok(root.querySelector('form.login-card'));
});

test('saved password rejected -> login screen and credentials wiped', async () => {
  const { app, root, vault } = setup({
    getCourses: async () => { throw new MoodleError('invalidtoken'); },
    requestToken: async () => { throw new MoodleError('invalidlogin'); },
  }, true);
  await vault.save('u', 'old');
  await app.start();
  assert.ok(root.querySelector('form.login-card'));
  assert.equal(await vault.load(), null);
});

test('renewal blocked only by the network keeps credentials and shows cached data', async () => {
  const { app, root, vault, cache } = setup({
    getCourses: async () => { throw new MoodleError('invalidtoken'); },
    requestToken: async () => { throw new MoodleError('network'); },
  }, true);
  await vault.save('u', 'pw');
  cache.set('courses', sampleCourses);
  await app.start();
  assert.equal(root.querySelectorAll('a.card').length, 2);
  assert.ok(root.querySelector('.banner'));
  assert.deepEqual(await vault.load(), { username: 'u', password: 'pw' });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/app.js`

```js
import { clear, h } from './ui/dom.js';
import { renderLogin } from './ui/login.js';
import { renderCourseList } from './ui/courses.js';
import { renderCourse, renderBack } from './ui/course.js';
import { buildCourse } from './content.js';
import { describeError } from './errors.js';
import { MoodleError } from './api.js';
import { STRINGS as S } from './strings.js';

export function createApp({ root, api, auth, cache, win = globalThis.window }) {
  let courses = [];
  let offline = false;
  let shell = null;
  let listPane = null;
  let detailPane = null;

  const route = () => {
    const m = /^#\/course\/(\d+)$/.exec(win.location.hash);
    return m ? Number(m[1]) : null;
  };

  function showLogin(message = '') {
    shell = null;
    clear(root).append(renderLogin({ message, onSubmit: login }));
  }

  async function login(username, password) {
    await auth.login(username, password); // rejection is shown by the login form
    await showShell();
  }

  function logout(message = '') {
    auth.logout();
    cache.clear();
    courses = [];
    showLogin(message);
    if (win.location.hash) win.location.hash = '';
  }

  // Run an authenticated call. On an expired token, silently renew it from the
  // saved credentials and retry exactly once.
  async function call(fn) {
    try {
      return await fn(auth.getSession());
    } catch (err) {
      if (!err || err.code !== 'invalidtoken') throw err;
      let fresh;
      try {
        fresh = await auth.relogin();
      } catch (reErr) {
        // Saved password rejected -> treat as a dead session; anything else (network) propagates.
        if (reErr && reErr.code === 'invalidlogin') throw new MoodleError('invalidtoken');
        throw reErr;
      }
      if (!fresh) throw err; // nothing saved
      return fn(fresh);
    }
  }

  function handleFatal(err) {
    if (err && err.code === 'invalidtoken') {
      logout(S.errors.invalidtoken);
      return true;
    }
    return false;
  }

  function renderList() {
    const { token } = auth.getSession();
    clear(listPane).append(
      h('header', { class: 'bar' },
        h('h1', {}, S.courses),
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout)),
      offline ? h('p', { class: 'banner' }, S.offline) : null,
      renderCourseList({ courses, token, selectedId: route() }));
  }

  async function loadCourses() {
    try {
      courses = await call((s) => api.getCourses(s.token, s.userid));
      cache.set('courses', courses);
      offline = false;
    } catch (err) {
      if (handleFatal(err)) return false;
      const saved = cache.get('courses');
      if (!saved) {
        clear(listPane).append(
          h('p', { class: 'error' }, describeError(err)),
          h('button', { class: 'btn retry', type: 'button', onclick: () => showShell() }, S.retry));
        return false;
      }
      courses = saved.data;
      offline = true;
    }
    return true;
  }

  async function showShell() {
    const session = auth.getSession();
    if (!session) return showLogin();
    listPane = h('aside', { class: 'pane-list' }, h('p', { class: 'status' }, S.loading));
    detailPane = h('main', { class: 'pane-detail' });
    shell = h('div', { class: 'shell' }, listPane, detailPane);
    clear(root).append(shell);
    if (await loadCourses()) await showRoute();
    return undefined;
  }

  async function showRoute() {
    const session = auth.getSession();
    if (!session || !shell) return;
    const id = route();
    shell.classList.toggle('has-detail', id !== null);
    renderList();
    if (id === null) {
      clear(detailPane).append(h('p', { class: 'placeholder' }, S.pickCourse));
      return;
    }
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    let sections;
    let fromCache = false;
    try {
      sections = await call((s) => api.getCourseContents(s.token, id));
      cache.set(`course:${id}`, sections);
    } catch (err) {
      if (handleFatal(err)) return;
      const saved = cache.get(`course:${id}`);
      if (!saved) {
        if (route() === id) clear(detailPane).append(renderBack(), h('p', { class: 'error' }, describeError(err)));
        return;
      }
      sections = saved.data;
      fromCache = true;
    }
    if (route() !== id) return; // user navigated away while loading
    const info = courses.find((c) => c.id === id);
    const live = auth.getSession() || session; // token may have been renewed during the call
    clear(detailPane).append(renderCourse({
      course: { id, fullname: info ? info.fullname : '', sections: buildCourse(sections, live.token) },
      token: live.token,
      offline: fromCache,
    }));
  }

  async function start() {
    win.addEventListener('hashchange', () => { if (shell) showRoute(); });
    if (auth.getSession()) await showShell();
    else showLogin();
  }

  return { start, login, logout, showRoute };
}
```

- [ ] **Step 4: Run, expect PASS.** If the "invalid token" test fails because the expiry message is cleared, check that `showLogin(message)` is not overwritten by a later render.

- [ ] **Step 5: Write `src/main.js` and `index.html`**

`src/main.js`:
```js
import * as api from './api.js';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createCache } from './store.js';
import { getStorage } from './storage.js';
import { createVault, createIdbKeyStore } from './vault.js';

const storage = getStorage();
const vault = createVault({ storage, keyStore: createIdbKeyStore() });
const app = createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api, vault }),
  cache: createCache(storage),
});
app.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
}
```
`index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://aules.edu.gva.es; connect-src https://aules.edu.gva.es; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="theme-color" content="#1b5fa8">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Aules">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/icon-180.png">
  <link rel="stylesheet" href="src/styles.css">
  <title>Aules</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write dev tools**

`tools/serve.mjs`:
```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) throw new Error('outside root');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8080, '127.0.0.1', () => console.log('http://localhost:8080  (preview: /tools/preview.html)'));
```
`tools/preview.html` (fixture-driven, no network, no CSP so the inline-free module still loads):
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link rel="stylesheet" href="../src/styles.css">
  <title>Aules preview (fixtures)</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="preview.js"></script>
</body>
</html>
```
`tools/preview.js`:
```js
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCache } from '../src/store.js';
import { createMemoryStorage } from '../src/storage.js';
import { sampleCourses, sampleSections } from '../tests/fixtures.js';

const storage = createMemoryStorage();
storage.setItem('aules.session', JSON.stringify({ token: 'demo', userid: 1, fullname: 'Demo' }));
const api = {
  requestToken: async () => 'demo',
  getSiteInfo: async () => ({ userid: 1, fullname: 'Demo' }),
  getCourses: async () => sampleCourses,
  getCourseContents: async () => sampleSections,
};
createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api }),
  cache: createCache(storage),
}).start();
```

- [ ] **Step 7: Run `npm test`, expect PASS**, commit

```bash
git add -A && git commit -m "feat: app wiring, entry point, dev server and preview"
```

---

### Task 9: PWA shell (manifest, icons, service worker)

**Files:**
- Create: `manifest.webmanifest`, `tools/make-icons.mjs`, `icons/icon-180.png`, `icons/icon-192.png`, `icons/icon-512.png` (generated), `sw.js`, `tests/shell.test.js`

**Interfaces:**
- Produces: `sw.js` with `const SHELL = [...]` (JSON-compatible, double-quoted, relative paths) listing every file needed to launch offline; same-origin GET requests use stale-while-revalidate; cross-origin requests (aules) are never intercepted or cached.

- [ ] **Step 1: Write the failing test** `tests/shell.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Write `manifest.webmanifest`**

```json
{
  "name": "Aules",
  "short_name": "Aules",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f4f6f9",
  "theme_color": "#1b5fa8",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Write `tools/make-icons.mjs` and run it**

```js
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function png(size) {
  const bg = [27, 95, 168];
  const fg = [255, 255, 255];
  const m = size * 0.25;
  const t = size * 0.08;
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const inBox = x >= m && x < size - m && y >= m && y < size - m;
      const inInner = x >= m + t && x < size - m - t && y >= m + t && y < size - m - t;
      raw.set(inBox && !inInner ? fg : bg, y * stride + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const s of [180, 192, 512]) {
  writeFileSync(new URL(`../icons/icon-${s}.png`, import.meta.url), png(s));
}
console.log('icons written');
```
Run: `node tools/make-icons.mjs`. Expected: `icons written`; three PNGs exist.

- [ ] **Step 5: Write `sw.js`**

```js
const VERSION = "v1";
const CACHE = `aules-shell-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/api.js",
  "./src/app.js",
  "./src/auth.js",
  "./src/config.js",
  "./src/content.js",
  "./src/errors.js",
  "./src/main.js",
  "./src/sanitize.js",
  "./src/storage.js",
  "./src/store.js",
  "./src/strings.js",
  "./src/styles.css",
  "./src/vault.js",
  "./src/ui/course.js",
  "./src/ui/courses.js",
  "./src/ui/dom.js",
  "./src/ui/login.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs: serve the cached copy immediately and refresh it in the background.
// Cross-origin requests (the aules API and files) are never touched, so tokens are never cached.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
```

- [ ] **Step 6: Run `npm test`, expect PASS**, commit

```bash
git add -A && git commit -m "feat: PWA manifest, icons and offline service worker"
```

---

### Task 10: Docs and visual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** with these sections (real content, no placeholders):
  - **What it is** (one paragraph) and **how it works** (token via `login/token.php`, REST calls, no backend).
  - **Run locally:** `npm install`, `npm test`, `npm run serve`, open `http://localhost:8080/` (real site; needs credentials typed by the user) or `http://localhost:8080/tools/preview.html` (fixtures, no network).
  - **Deploy (user decision, not done automatically):** copy the repo root's `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `src/` to any HTTPS static host (e.g. GitHub Pages); all paths are relative, so a sub-path works. Bump `VERSION` in `sw.js` when shipping changes.
  - **Install on iPhone/iPad:** open the HTTPS URL in Safari -> Share -> Add to Home Screen.
  - **First-login checklist (do on the device):** sign in with your user number + password; if you see "did not issue an access token" / "mobile service is not enabled", the account cannot use the mobile API and a scraping fallback is needed (out of v1 scope).
  - **Security notes:** the login is saved encrypted on the device (AES-GCM, non-extractable key in IndexedDB, ciphertext in localStorage) so expired sessions renew silently; this protects against casual reading of storage, not against someone with unlocked access to the app. Set an iOS passcode. Sign out deletes saved login, token and cache. If the Aules password changes, the app asks you to sign in again.

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: all suites PASS, 0 failures.

- [ ] **Step 3: Visual check with the preview harness**

Run (background): `npm run serve`. In the Browser pane open `http://localhost:8080/tools/preview.html`. Using `resize_window`: 
- `mobile` preset (375x812): course list fits, no horizontal scroll, tapping a card shows only the course view with a working "‹ Courses" back link; first section open; hidden "Secret" module absent; "Questions" shows the "Not available" note.
- `tablet` preset (768x1024): two columns, list stays visible, back link hidden, selected card highlighted.
- Emulate dark color scheme (`colorScheme: "dark"`) and confirm readable contrast.
- Open `http://localhost:8080/` and confirm the login screen renders at both sizes (do **not** type any credentials).
Capture screenshots; fix any layout bug in `src/styles.css` and re-run `npm test`. Restore the viewport with `preset: "desktop"` and stop the server.

- [ ] **Step 4: Service-worker check**

In the Browser pane at `http://localhost:8080/`, confirm via `javascript_tool` that `navigator.serviceWorker.getRegistration()` resolves and `caches.keys()` contains `aules-shell-v1`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: README and verified responsive layout"
```

- [ ] **Step 6: Hand off to the user** with: the README's install/first-login steps, and an explicit note that publishing to a host and the first real login are the user's actions.

---

## Self-Review (done)

- **Spec coverage:** login/token + REST (Tasks 2-3), course list + search (7), course content incl. files/links/pages/folders/labels (6-7), logout clears token + cache (8, test), offline shell + cached data (4, 8, 9), sanitizer + CSP + referrer + token scoping (5, 6, 9), safe-area/iPad two-column/dark mode (7, 10), tests with mocked Moodle responses (2-8), visual check at iPhone/iPad sizes (10), hosting deferred to user (README). No gaps found.
- **Placeholders:** none; every code step has full code.
- **Type consistency:** `requestToken/getSiteInfo/getCourses/getCourseContents` signatures match across api.js, auth.js, app.js, fakes in tests, and preview. `ViewModule.kind` values match `renderModule`. `withToken` used identically in content.js, courses.js, course.js. Session shape `{token, userid, fullname}` consistent. Cache keys `courses` / `course:<id>` consistent between app.js and tests.
- **Review Focus coverage:** items 1-2 -> Task 2 tests; 3 -> Task 3 tests; 4 -> Task 5 tests; 5 -> Task 6 tests; 6 -> Tasks 3b and 8 tests.
- **Silent relogin (added 2026-10-13 at the user's request):** vault + relogin (3b), single-retry `call()` and fallbacks (8), login note string (1, 7), SW shell and README updated.
