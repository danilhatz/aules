# Category Folders, Course Restyle and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group courses into Aules category folders, restyle the course page for language learning, and add a Diagnostics screen that reports what the user's Aules account/token can do.

**Architecture:** Extends the existing vanilla-ES-module PWA. New pure modules (`courses.js` grouping + source fallback, `folders.js` open-state, `diagnostics.js` redacted report) are unit-tested without DOM; UI modules render with jsdom-tested DOM; `app.js` wires a new `#/diagnostics` route and the new course loader behind the existing silent-renewal `call()`.

**Tech Stack:** Same as v1 (browser ES modules, Fetch, localStorage; dev: Node >= 20 `node:test`, `jsdom`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-categories-diagnostics-design.md` (extends `2026-10-13-aules-mobile-pwa-design.md`)

## Global Constraints

- Vanilla ES modules, **no build step**, no new runtime/dev dependencies.
- **Read-only:** this sub-project adds no calls that write to Aules.
- Site base `https://aules.edu.gva.es/fpa`; the strict CSP in `index.html` is unchanged (`img-src 'self' https://aules.edu.gva.es`, `connect-src https://aules.edu.gva.es`, no inline styles/scripts).
- All new Moodle-calling code runs through `app.js`'s `call()` (silent token renewal, retried once); `invalidtoken` and `network` errors must propagate out of loaders so renewal and the offline cache keep working.
- Token is appended only to `https://aules.edu.gva.es/fpa/webservice/pluginfile.php/...` URLs (`withToken`); never to other hosts or paths.
- Diagnostics output is built from an **allow-list** and never contains: token, password, user id, user/full names, site name, course names, file names, URLs.
- All Moodle-supplied text is rendered with `textContent`/`h()` (never `innerHTML`) except sanitized module HTML via `sanitizeHtml`.
- Tests use dummy values only (user number `10000001`); **no real credentials anywhere**. The assistant never enters the user's credentials into the live site.
- Touch targets >= 44px; body text 17px; light + dark mode; phone one-pane / iPad two-pane layout preserved.
- `node --test` must stay green after every task. Nothing is pushed or published without the user's explicit approval.

## Review Focus

1. Category source failures: `core_course_get_enrolled_courses_by_timeline_classification` returning an Moodle error (e.g. `accessexception`), an empty list, a non-array, or the function missing -> silent fallback to source 2/3 with **no error shown**; but `invalidtoken`/`network` still propagate. (Task 2)
2. Hostile/messy names: accents (sorting `Álgebra` before `Biología`), `<img onerror>` in a course or category name rendered as plain text, empty/whitespace category, same category name twice, very long names. (Tasks 2, 3)
3. Search with persisted folder state: searching force-opens matching folders and hides others, clearing the search restores the user's saved open/closed state, and the search itself never overwrites saved state. (Task 3)
4. Diagnostics never leaks: tokens/URLs/filenames/names inside values, data-looking object keys, a malformed `functions` entry, hostile release string; and one failing call is reported inline without aborting. (Task 5)
5. Course images: `courseimage` that is a `data:` URI, a `javascript:` URL, or a plain `/pluginfile.php/` URL (needs `/webservice/` rewrite before the token is added). (Tasks 1, 2)

---

## File Structure

```
src/api.js                +getCoursesByTimeline, +getCategories
src/content.js            +toWebserviceUrl; ViewModule gains modname/soon; ViewSection gains number
src/courses.js            NEW normalizeCourse, groupCourses, loadCourseList
src/folders.js            NEW createFolderState(storage)
src/diagnostics.js        NEW shapeOf, buildReport, runDiagnostics
src/ui/courses.js         folders + cross-folder search (uses c.image / c.category)
src/ui/course.js          unit cards, type chips, coming-soon notes, progress bar
src/ui/diagnostics.js     NEW renderDiagnostics
src/app.js                #/diagnostics route, header link, loader, folderState, progress
src/main.js               pass folderState
src/strings.js            new strings
src/styles.css            folders, units, chips, 17px text
sw.js                     SHELL +4 files, VERSION v2
tests/fixtures.js         +sampleTimelineCourses, +glossary module
tools/preview.js          categorised demo api incl. site info functions
tests/*.test.js           per task
README.md                 document categories + diagnostics
```

---

### Task 1: API additions and file-URL rewrite

**Files:**
- Modify: `src/api.js`, `src/content.js`
- Test: `tests/api.test.js`, `tests/content.test.js`

**Interfaces:**
- Consumes: existing `ws()` helper (module-private) and `SITE`/`FILE_PREFIX` in content.js.
- Produces:
  - `getCoursesByTimeline(token, opts?) -> Promise<{courses: object[]}>` (calls `core_course_get_enrolled_courses_by_timeline_classification` with `classification=all`, `limit=0`).
  - `getCategories(token, ids: number[], opts?) -> Promise<{id, name, ...}[]>` (calls `core_course_get_categories` with `criteria[0][key]=ids`, `criteria[0][value]=<comma ids>`, `addsubcategories=0`).
  - `toWebserviceUrl(url: string) -> string` — rewrites `https://aules.edu.gva.es/fpa/pluginfile.php/...` to `.../fpa/webservice/pluginfile.php/...`; anything else unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api.test.js` (also add `getCoursesByTimeline, getCategories` to its import from `../src/api.js`):
```js
test('getCoursesByTimeline requests all courses without a limit', async () => {
  const calls = [];
  const r = await getCoursesByTimeline('tok', { fetchImpl: ok({ courses: [{ id: 1 }] }, calls) });
  assert.deepEqual(r, { courses: [{ id: 1 }] });
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wsfunction'), 'core_course_get_enrolled_courses_by_timeline_classification');
  assert.equal(b.get('classification'), 'all');
  assert.equal(b.get('limit'), '0');
});

test('getCategories sends the ids criteria as a comma list', async () => {
  const calls = [];
  await getCategories('tok', [3, 5, 8], { fetchImpl: ok([{ id: 3, name: 'A' }], calls) });
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wsfunction'), 'core_course_get_categories');
  assert.equal(b.get('criteria[0][key]'), 'ids');
  assert.equal(b.get('criteria[0][value]'), '3,5,8');
  assert.equal(b.get('addsubcategories'), '0');
});
```
Append to `tests/content.test.js` (add `toWebserviceUrl` to its import):
```js
test('toWebserviceUrl rewrites only this instance\'s plain pluginfile URLs', () => {
  const S = 'https://aules.edu.gva.es/fpa';
  assert.equal(toWebserviceUrl(`${S}/pluginfile.php/5/course/overviewfiles/a.png`), `${S}/webservice/pluginfile.php/5/course/overviewfiles/a.png`);
  assert.equal(toWebserviceUrl(`${S}/pluginfile.php/5/a.png?x=1`), `${S}/webservice/pluginfile.php/5/a.png?x=1`);
  assert.equal(toWebserviceUrl(`${S}/webservice/pluginfile.php/5/a.png`), `${S}/webservice/pluginfile.php/5/a.png`);
  assert.equal(toWebserviceUrl('https://aules.edu.gva.es/eso/pluginfile.php/5/a.png'), 'https://aules.edu.gva.es/eso/pluginfile.php/5/a.png');
  assert.equal(toWebserviceUrl('https://evil.example/fpa/pluginfile.php/5/a.png'), 'https://evil.example/fpa/pluginfile.php/5/a.png');
  assert.equal(toWebserviceUrl('not a url'), 'not a url');
});
```

- [ ] **Step 2: Run, expect FAIL** — `npm test` -> import errors / `getCoursesByTimeline is not a function`.

- [ ] **Step 3: Implement**

Append to `src/api.js`:
```js
export const getCoursesByTimeline = (token, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_enrolled_courses_by_timeline_classification', { classification: 'all', limit: 0 }, fetchImpl);

export const getCategories = (token, ids, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_categories', { 'criteria[0][key]': 'ids', 'criteria[0][value]': ids.join(','), addsubcategories: 0 }, fetchImpl);
```
Add to `src/content.js` (after `withToken`):
```js
const PLAIN_PREFIX = `${SITE.pathname}/pluginfile.php/`;

// Moodle hands out plain /pluginfile.php/ image URLs in some responses; the token only works on the webservice path.
export function toWebserviceUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.origin !== SITE.origin || !u.pathname.startsWith(PLAIN_PREFIX)) return url;
  u.pathname = FILE_PREFIX + u.pathname.slice(PLAIN_PREFIX.length);
  return u.toString();
}
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: category/timeline API calls and webservice file URL rewrite"
```

---

### Task 2: Course normalisation, grouping and the source-fallback loader

**Files:**
- Create: `src/courses.js`, `tests/courses.test.js`
- Modify: `src/strings.js` (add `uncategorised: 'Other courses'`)

**Interfaces:**
- Consumes: `api.getCoursesByTimeline`, `api.getCourses`, `api.getCategories`, `MoodleError`, `toWebserviceUrl`, `isSafeHttpUrl`.
- Produces:
  - `normalizeCourse(raw, names = {}) -> {id:number, fullname:string, shortname:string, progress:number|null, image:string, category:string}` (`image` is `''` or a safe http(s) URL already on the webservice path; `category` is `raw.coursecategory` or `names[raw.category]` or `''`).
  - `groupCourses(courses, uncategorisedName) -> {name:string, courses:Course[]}[]` — folders sorted by name (`localeCompare` with locale `'es'`, base sensitivity), courses sorted by `fullname`, the uncategorised folder last.
  - `loadCourseList({api, token, userid}) -> Promise<{courses:Course[], source:1|2|3, raw:object|null}>`; `raw` is the first raw course object from the winning source (used by Diagnostics). Re-throws only errors whose `code` is `invalidtoken` or `network`.

- [ ] **Step 1: Write the failing tests** `tests/courses.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourse, groupCourses, loadCourseList } from '../src/courses.js';
import { MoodleError } from '../src/api.js';

const S = 'https://aules.edu.gva.es/fpa';

test('normalizeCourse maps a timeline course and rewrites the image URL', () => {
  const c = normalizeCourse({ id: 4, fullname: 'Español A1', shortname: 'ES-A1', coursecategory: ' Español ', progress: 42.5, courseimage: `${S}/pluginfile.php/9/course/overviewfiles/a.png` });
  assert.deepEqual(c, { id: 4, fullname: 'Español A1', shortname: 'ES-A1', progress: 42.5, image: `${S}/webservice/pluginfile.php/9/course/overviewfiles/a.png`, category: 'Español' });
});

test('normalizeCourse maps users_courses data using the category name map and overviewfiles', () => {
  const c = normalizeCourse({ id: 5, fullname: 'X', shortname: 'x', category: 7, progress: null, overviewfiles: [{ fileurl: `${S}/webservice/pluginfile.php/1/a.png` }] }, { 7: 'Cultura' });
  assert.equal(c.category, 'Cultura');
  assert.equal(c.image, `${S}/webservice/pluginfile.php/1/a.png`);
  assert.equal(c.progress, null);
});

test('normalizeCourse drops unsafe or data: images and tolerates missing fields', () => {
  assert.equal(normalizeCourse({ id: 1, courseimage: 'data:image/svg+xml;base64,AAAA' }).image, '');
  assert.equal(normalizeCourse({ id: 1, courseimage: 'javascript:alert(1)' }).image, '');
  const c = normalizeCourse({ id: 2 });
  assert.deepEqual(c, { id: 2, fullname: '', shortname: '', progress: null, image: '', category: '' });
});

test('groupCourses sorts accented names, puts uncategorised last, keeps hostile names as data', () => {
  const g = groupCourses([
    { id: 1, fullname: 'Zeta', category: 'Biología' },
    { id: 2, fullname: 'Alfa', category: 'Álgebra' },
    { id: 3, fullname: 'Beta', category: '' },
    { id: 4, fullname: '<img src=x onerror=alert(1)>', category: 'Biología' },
    { id: 5, fullname: 'Alef', category: 'Biología' },
  ], 'Other courses');
  assert.deepEqual(g.map((x) => x.name), ['Álgebra', 'Biología', 'Other courses']);
  assert.deepEqual(g[1].courses.map((c) => c.id), [4, 5, 1]); // '<' sorts before letters
  assert.equal(g[2].courses[0].id, 3);
});

test('groupCourses: empty -> no groups; single category -> one group', () => {
  assert.deepEqual(groupCourses([], 'Other'), []);
  assert.equal(groupCourses([{ id: 1, fullname: 'a', category: 'A' }], 'Other').length, 1);
});

const timeline = (courses) => async () => ({ courses });

test('source 1: timeline categories win and raw is the first raw course', async () => {
  const api = { getCoursesByTimeline: timeline([{ id: 1, fullname: 'A', coursecategory: 'Cat' }]) };
  const r = await loadCourseList({ api, token: 't', userid: 1 });
  assert.equal(r.source, 1);
  assert.equal(r.courses[0].category, 'Cat');
  assert.equal(r.raw.id, 1);
});

test('falls back to source 2 when the timeline call fails with a Moodle error', async () => {
  const api = {
    getCoursesByTimeline: async () => { throw new MoodleError('accessexception'); },
    getCourses: async () => [{ id: 1, fullname: 'A', category: 7 }, { id: 2, fullname: 'B', category: 8 }],
    getCategories: async (token, ids) => { assert.deepEqual(ids, [7, 8]); return [{ id: 7, name: 'Uno' }, { id: 8, name: 'Dos' }]; },
  };
  const r = await loadCourseList({ api, token: 't', userid: 1 });
  assert.equal(r.source, 2);
  assert.deepEqual(r.courses.map((c) => c.category), ['Uno', 'Dos']);
});

test('falls back when the timeline is empty, not an array, or the function is missing', async () => {
  const base = { getCourses: async () => [{ id: 1, fullname: 'A' }] };
  for (const api of [
    { ...base, getCoursesByTimeline: timeline([]) },
    { ...base, getCoursesByTimeline: async () => ({ courses: 'nope' }) },
    { ...base },
  ]) {
    const r = await loadCourseList({ api, token: 't', userid: 1 });
    assert.equal(r.source, 3);
    assert.equal(r.courses.length, 1);
  }
});

test('falls to source 3 (flat) when category lookup fails or returns nothing', async () => {
  const mk = (getCategories) => ({
    getCoursesByTimeline: async () => { throw new MoodleError('accessexception'); },
    getCourses: async () => [{ id: 1, fullname: 'A', category: 7 }],
    getCategories,
  });
  assert.equal((await loadCourseList({ api: mk(async () => { throw new MoodleError('accessexception'); }), token: 't', userid: 1 })).source, 3);
  assert.equal((await loadCourseList({ api: mk(async () => []), token: 't', userid: 1 })).source, 3);
});

test('invalidtoken and network errors propagate from every stage', async () => {
  const mk = (over) => ({ getCoursesByTimeline: timeline([]), getCourses: async () => [{ id: 1, category: 7 }], getCategories: async () => [], ...over });
  for (const code of ['invalidtoken', 'network']) {
    const err = () => { throw new MoodleError(code); };
    await assert.rejects(() => loadCourseList({ api: mk({ getCoursesByTimeline: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
    await assert.rejects(() => loadCourseList({ api: mk({ getCourses: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
    await assert.rejects(() => loadCourseList({ api: mk({ getCategories: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
  }
});

test('a non-array baseline response is a badresponse error', async () => {
  const api = { getCoursesByTimeline: timeline([]), getCourses: async () => null };
  await assert.rejects(() => loadCourseList({ api, token: 't', userid: 1 }), (e) => e.code === 'badresponse');
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../src/courses.js'`).

- [ ] **Step 3: Implement** `src/courses.js` (and add `uncategorised: 'Other courses',` to `src/strings.js` next to `empty`)

```js
import { MoodleError } from './api.js';
import { toWebserviceUrl } from './content.js';
import { isSafeHttpUrl } from './sanitize.js';

const FATAL = new Set(['invalidtoken', 'network']);
const isFatal = (e) => Boolean(e && FATAL.has(e.code));

function pickImage(c) {
  const first = c.overviewfiles && c.overviewfiles[0] && c.overviewfiles[0].fileurl;
  for (const cand of [c.courseimage, first]) {
    if (typeof cand !== 'string') continue;
    const url = toWebserviceUrl(cand);
    if (isSafeHttpUrl(url)) return url;
  }
  return '';
}

export function normalizeCourse(c, names = {}) {
  return {
    id: c.id,
    fullname: c.fullname || '',
    shortname: c.shortname || '',
    progress: typeof c.progress === 'number' ? c.progress : null,
    image: pickImage(c),
    category: String(c.coursecategory || names[c.category] || '').trim(),
  };
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.fullname, b.fullname);

export function groupCourses(courses, uncategorisedName) {
  const by = new Map();
  for (const c of courses) {
    const key = c.category || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  const groups = [...by.entries()]
    .filter(([name]) => name)
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([name, list]) => ({ name, courses: [...list].sort(byName) }));
  if (by.has('')) groups.push({ name: uncategorisedName, courses: [...by.get('')].sort(byName) });
  return groups;
}

// Source 1: timeline overview (has category names). Source 2: enrolled courses + category lookup.
// Source 3: enrolled courses, flat. Only auth/network failures abort; anything else falls through.
export async function loadCourseList({ api, token, userid }) {
  try {
    const r = await api.getCoursesByTimeline(token);
    const raw = r && Array.isArray(r.courses) ? r.courses : [];
    if (raw.length) return { courses: raw.map((c) => normalizeCourse(c)), source: 1, raw: raw[0] };
  } catch (e) {
    if (isFatal(e)) throw e;
  }
  const raw = await api.getCourses(token, userid);
  if (!Array.isArray(raw)) throw new MoodleError('badresponse');
  const ids = [...new Set(raw.map((c) => c.category).filter((id) => id != null))];
  if (ids.length) {
    try {
      const cats = await api.getCategories(token, ids);
      const names = Object.fromEntries((Array.isArray(cats) ? cats : []).map((k) => [k.id, k.name]));
      if (Object.keys(names).length) {
        return { courses: raw.map((c) => normalizeCourse(c, names)), source: 2, raw: raw[0] || null };
      }
    } catch (e) {
      if (isFatal(e)) throw e;
    }
  }
  return { courses: raw.map((c) => normalizeCourse(c)), source: 3, raw: raw[0] || null };
}
```

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: course normalisation, grouping and category source fallback"
```

---

### Task 3: Folder state and the folder UI with cross-folder search

**Files:**
- Create: `src/folders.js`, `tests/folders.test.js`
- Modify: `src/ui/courses.js` (replace contents), `src/strings.js` (nothing new), `src/styles.css`, `tests/ui.test.js`

**Interfaces:**
- Consumes: `groupCourses`, `normalizeCourse`, `withToken`, `isSafeHttpUrl`, `STRINGS`.
- Produces:
  - `createFolderState(storage) -> {get(name): boolean|undefined, set(name, open): void}` (storage key `aules.folders`; best-effort, never throws).
  - `renderCourseList({courses: Course[], token, selectedId, folderState?}) -> HTMLElement`. Renders folders (`details.folder`, summary `.folder-name` + `.count`) when `groupCourses` yields more than one group, otherwise a flat `ul.cards`. Default open state: the folder holding the selected course is open; else saved state; else open when there are <= 3 folders. Search matches course name, short name or category; with a query non-empty matching folders are forced open and non-matching hidden; clearing restores each folder to its saved/default state. Toggling a folder saves its state only when no search is active.

- [ ] **Step 1: Write the failing tests**

`tests/folders.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage.js';
import { createFolderState } from '../src/folders.js';

test('get returns undefined until set; set persists booleans per folder name', () => {
  const s = createMemoryStorage();
  const f = createFolderState(s);
  assert.equal(f.get('A'), undefined);
  f.set('A', false);
  f.set('B', true);
  assert.equal(createFolderState(s).get('A'), false);
  assert.equal(createFolderState(s).get('B'), true);
});

test('corrupt storage and odd names are safe', () => {
  const s = createMemoryStorage();
  s.setItem('aules.folders', '{oops');
  const f = createFolderState(s);
  assert.equal(f.get('A'), undefined);
  assert.equal(f.get('__proto__'), undefined);
  f.set('__proto__', true);
  assert.equal(f.get('__proto__'), true);
});

test('storage failures never throw', () => {
  const s = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  const f = createFolderState(s);
  assert.doesNotThrow(() => f.set('A', true));
  assert.equal(f.get('A'), undefined);
});
```
In `tests/ui.test.js`: add imports `import { normalizeCourse } from '../src/courses.js';`, `import { createMemoryStorage } from '../src/storage.js';`, `const { createFolderState } = await import('../src/folders.js');`. Replace the two existing course-list tests (`course list renders cards...` and `empty course list...`) with:
```js
const norm = (list) => list.map((c) => normalizeCourse(c));

test('flat course list renders cards, token on image, selection and search filter', () => {
  const el = renderCourseList({ courses: norm(sampleCourses), token: 'T', selectedId: 12 });
  const cards = el.querySelectorAll('a.card');
  assert.equal(cards.length, 2);
  assert.equal(el.querySelectorAll('details.folder').length, 0);
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

const cats = [
  { id: 1, fullname: 'Gramática A1', shortname: 'G1', category: 'Español A1', progress: 10, image: '' },
  { id: 2, fullname: 'Vocabulario A1', shortname: 'V1', category: 'Español A1', progress: null, image: '' },
  { id: 3, fullname: 'Cultura', shortname: 'C', category: 'Español B1', progress: null, image: '' },
  { id: 4, fullname: 'Suelto', shortname: 'S', category: '', progress: null, image: '' },
];

test('categories render as folders with counts; uncategorised last; names are plain text', () => {
  const evil = [...cats, { id: 5, fullname: '<img src=x onerror=alert(1)>', shortname: '', category: 'Español B1', progress: null, image: '' }];
  const el = renderCourseList({ courses: evil, token: 'T' });
  const folders = [...el.querySelectorAll('details.folder')];
  assert.deepEqual(folders.map((f) => f.querySelector('.folder-name').textContent), ['Español A1', 'Español B1', 'Other courses']);
  assert.deepEqual(folders.map((f) => f.querySelector('.count').textContent), ['2', '2', '1']);
  assert.equal(el.querySelector('img'), null); // the hostile name did not become an element
  assert.ok(el.textContent.includes('<img src=x onerror=alert(1)>'));
});

test('default open: all open for <= 3 folders; selected course opens its folder', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, fullname: `C${i}`, shortname: '', category: `F${i}`, progress: null, image: '' }));
  const few = renderCourseList({ courses: cats, token: 'T' });
  assert.ok([...few.querySelectorAll('details.folder')].every((d) => d.open));
  const lots = renderCourseList({ courses: many, token: 'T', selectedId: 12 });
  const open = [...lots.querySelectorAll('details.folder')].map((d) => d.open);
  assert.deepEqual(open, [false, false, true, false, false]);
});

test('folder toggles persist and are restored on the next render', () => {
  const storage = createMemoryStorage();
  const folderState = createFolderState(storage);
  const el = renderCourseList({ courses: cats, token: 'T', folderState });
  const d = el.querySelector('details.folder');
  d.open = false;
  d.dispatchEvent(new window.Event('toggle'));
  const again = renderCourseList({ courses: cats, token: 'T', folderState: createFolderState(storage) });
  assert.equal(again.querySelector('details.folder').open, false);
});

test('search forces matching folders open, hides others, and restores saved state without overwriting it', async () => {
  const storage = createMemoryStorage();
  const folderState = createFolderState(storage);
  folderState.set('Español A1', false);
  const el = renderCourseList({ courses: cats, token: 'T', folderState });
  const [a1, b1] = el.querySelectorAll('details.folder');
  assert.equal(a1.open, false);
  const search = el.querySelector('input[type=search]');
  search.value = 'gram';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(a1.open, true);
  assert.equal(a1.hidden, false);
  assert.equal(b1.hidden, true);
  a1.dispatchEvent(new window.Event('toggle')); // a toggle during search must not be saved
  search.value = 'Español B1'; // matches by category name too
  search.dispatchEvent(new window.Event('input'));
  assert.equal(b1.hidden, false);
  assert.equal(a1.hidden, true);
  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(a1.open, false);
  assert.equal(a1.hidden, false);
  assert.equal(b1.hidden, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(createFolderState(storage).get('Español A1'), false);
});
```

- [ ] **Step 2: Run, expect FAIL** (`../src/folders.js` missing; old UI lacks folders).

- [ ] **Step 3: Implement**

`src/folders.js`:
```js
const KEY = 'aules.folders';

export function createFolderState(storage) {
  const read = () => {
    try { return JSON.parse(storage.getItem(KEY)) || {}; } catch { return {}; }
  };
  return {
    get(name) {
      const v = read()[name];
      return typeof v === 'boolean' ? v : undefined;
    },
    set(name, open) {
      try { storage.setItem(KEY, JSON.stringify({ ...read(), [name]: Boolean(open) })); } catch { /* best effort */ }
    },
  };
}
```
Replace `src/ui/courses.js`:
```js
import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { isSafeHttpUrl } from '../sanitize.js';
import { groupCourses } from '../courses.js';

function card(c, token, selectedId) {
  const img = c.image && withToken(c.image, token);
  return h('li', { 'data-text': `${c.fullname} ${c.shortname || ''} ${c.category || ''}`.toLowerCase() },
    h('a', { class: 'card', href: `#/course/${c.id}`, 'aria-current': c.id === selectedId ? 'page' : null },
      img && isSafeHttpUrl(img) ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb', 'aria-hidden': 'true' }),
      h('span', { class: 'meta' }, h('strong', {}, c.fullname), h('small', {}, c.shortname || '')),
      typeof c.progress === 'number' ? h('progress', { max: 100, value: Math.round(c.progress) }) : null));
}

export function renderCourseList({ courses, token, selectedId, folderState }) {
  const groups = groupCourses(courses, S.uncategorised);
  const asFolders = groups.length > 1;
  let searching = false;

  const wantOpen = (g) => {
    if (g.courses.some((c) => c.id === selectedId)) return true;
    const saved = folderState && folderState.get(g.name);
    return saved === undefined ? groups.length <= 3 : saved;
  };

  const entries = groups.map((g) => ({ g, lis: g.courses.map((c) => card(c, token, selectedId)) }));
  const details = [];
  const body = asFolders
    ? h('div', { class: 'folders' }, entries.map(({ g, lis }) => {
      const d = h('details', { class: 'folder', open: wantOpen(g) },
        h('summary', {}, h('span', { class: 'folder-name' }, g.name), h('span', { class: 'count' }, String(g.courses.length))),
        h('ul', { class: 'cards' }, lis));
      d.addEventListener('toggle', () => { if (!searching && folderState) folderState.set(g.name, d.open); });
      details.push(d);
      return d;
    }))
    : h('ul', { class: 'cards' }, entries.flatMap((e) => e.lis));

  const empty = h('p', { class: 'status' }, S.empty);
  empty.hidden = courses.length > 0;
  const search = h('input', {
    type: 'search', class: 'search', placeholder: S.search, 'aria-label': S.search,
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      searching = q !== '';
      let shown = 0;
      entries.forEach(({ g, lis }, i) => {
        let hits = 0;
        for (const li of lis) {
          const hit = !q || li.dataset.text.includes(q);
          li.hidden = !hit;
          if (hit) hits += 1;
        }
        shown += hits;
        if (asFolders) {
          details[i].hidden = hits === 0;
          details[i].open = q ? hits > 0 : wantOpen(g);
        }
      });
      empty.hidden = shown > 0;
    },
  });
  return h('div', { class: 'courses' }, search, empty, body);
}
```
Append to `src/styles.css`:
```css
/* Category folders */
.folders { padding: 0 0 8px; }
.folder { margin: 0 16px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.folder > summary { display: flex; align-items: center; gap: 8px; padding: 14px 16px; min-height: 48px; font-weight: 600; cursor: pointer; }
.folder-name { flex: 1; overflow-wrap: anywhere; }
.count { min-width: 28px; padding: 2px 8px; border-radius: 999px; background: var(--bg); color: var(--muted); font-size: 14px; text-align: center; }
.folder .cards { padding: 0 12px 12px; }
```

- [ ] **Step 4: Run `npm test`, expect PASS.** (If `tests/app.test.js` fails because the list now needs `c.image`, it should not: the app is updated in Task 6; those tests use the old `renderCourseList` input via the unchanged `app.js` which still passes raw courses — raw courses have no `image`/`category`, so cards render with a thumb placeholder and one flat group. Confirm they pass.) Commit:
```bash
git add -A && git commit -m "feat: category folders UI with persisted state and cross-folder search"
```

---

### Task 4: Course page restyle (unit cards, type chips, coming soon, progress)

**Files:**
- Modify: `src/content.js`, `src/strings.js`, `src/ui/course.js`, `src/styles.css`, `tests/fixtures.js`, `tests/content.test.js`, `tests/ui.test.js`

**Interfaces:**
- Consumes: `buildCourse`, `STRINGS`.
- Produces:
  - `ViewModule` gains `modname: string` (raw, `''` if absent) and, for unsupported types, `soon: true` when `modname` is `assign`, `quiz` or `forum` (all unsupported modules keep `kind: 'other'`, `unsupported: true`).
  - `ViewSection` gains `number: number` (`section.section ?? index`).
  - `STRINGS.types = {page:'Reading', resource:'File', folder:'Folder', url:'Link', assign:'Exercise', quiz:'Quiz', forum:'Forum', other:'Activity'}`, `STRINGS.comingSoon = 'Coming soon'`, `STRINGS.unit = 'Unit'`.
  - `renderCourse({course:{id, fullname, sections, progress?}, token, offline?})` — sections render as `details.section.unit` with `.unit-no` (only when `number > 0`) and `.unit-name`; each non-label module shows `span.chip`; `small.soon` text is `comingSoon` for `soon` modules, `unsupported` otherwise; header shows `progress.course-progress` when `course.progress` is a number.

- [ ] **Step 1: Update fixtures and write the failing tests**

In `tests/fixtures.js` add a glossary module at the end of section 101's `modules` array (after the forum, before the closing `]`):
```js
      { id: 8, name: 'Glossary', modname: 'glossary', uservisible: true },
```
Append to `tests/content.test.js`:
```js
test('modules carry modname; assign/quiz/forum are marked soon; other unsupported types are not', () => {
  const [, unit] = buildCourse(sampleSections, 'T');
  const byName = Object.fromEntries(unit.modules.map((m) => [m.name, m]));
  assert.equal(byName.Questions.modname, 'forum');
  assert.equal(byName.Questions.soon, true);
  assert.equal(byName.Glossary.unsupported, true);
  assert.equal(byName.Glossary.soon, undefined);
  assert.equal(byName.Reading.modname, 'page');
  const v = buildCourse([{ id: 1, section: 0, name: 'S', summary: '', modules: [
    { id: 1, name: 'HW', modname: 'assign' }, { id: 2, name: 'Q', modname: 'quiz' }, { id: 3, name: 'X' },
  ] }], 'T');
  assert.deepEqual(v[0].modules.map((m) => [m.modname, Boolean(m.soon)]), [['assign', true], ['quiz', true], ['', false]]);
});

test('sections carry their Moodle section number', () => {
  const v = buildCourse(sampleSections, 'T');
  assert.deepEqual(v.map((s) => s.number), [0, 1]);
  const w = buildCourse([{ id: 1, name: 'A', summary: '<p>x</p>' }], 'T');
  assert.equal(w[0].number, 0);
});
```
In `tests/ui.test.js`, replace the assertion `assert.ok(el.textContent.includes('Not available in this app yet'));` inside the `course view: sections...` test with:
```js
  assert.ok(el.textContent.includes('Not available in this app yet')); // glossary (unknown type)
  assert.ok(el.querySelector('.soon').textContent === 'Coming soon' || [...el.querySelectorAll('.soon')].some((n) => n.textContent === 'Coming soon')); // forum
```
and append:
```js
test('course view shows unit numbers (not for section 0), type chips and progress', () => {
  const sections = buildCourse(sampleSections, 'T');
  const el = renderCourse({ course: { id: 11, fullname: 'Programació', sections, progress: 40 }, token: 'T' });
  const units = el.querySelectorAll('details.unit');
  assert.equal(units[0].querySelector('.unit-no'), null);
  assert.equal(units[1].querySelector('.unit-no').textContent, '1');
  assert.equal(units[1].querySelector('.unit-name').textContent, 'Section 1');
  const chips = [...el.querySelectorAll('.chip')].map((c) => c.textContent);
  assert.ok(chips.includes('File') && chips.includes('Link') && chips.includes('Folder') && chips.includes('Reading') && chips.includes('Forum') && chips.includes('Activity'));
  assert.equal(el.querySelector('.mod.label .chip'), null);
  assert.equal(el.querySelector('progress.course-progress').value, 40);
});

test('course view without progress shows no progress bar', () => {
  const el = renderCourse({ course: { id: 1, fullname: 'X', sections: buildCourse(sampleSections, 'T') }, token: 'T' });
  assert.equal(el.querySelector('progress'), null);
});
```

- [ ] **Step 2: Run, expect FAIL** (`modname` undefined, `.unit-no` missing).

- [ ] **Step 3: Implement**

`src/strings.js`: add after `saveNote`:
```js
  unit: 'Unit',
  comingSoon: 'Coming soon',
  types: { page: 'Reading', resource: 'File', folder: 'Folder', url: 'Link', assign: 'Exercise', quiz: 'Quiz', forum: 'Forum', other: 'Activity' },
```
`src/content.js`: in `buildModule` change the `base` line to
```js
  const base = { id: m.id, name: m.name || '', modname: m.modname || '', description: m.description || '', links: [] };
```
and the `default:` branch to
```js
    default:
      return { ...base, kind: 'other', unsupported: true, ...(SOON.has(m.modname) ? { soon: true } : {}) };
```
add near the top of the file (after `FILE_PREFIX`): `const SOON = new Set(['assign', 'quiz', 'forum']);` and in `buildCourse`'s mapped object add `number: s.section ?? i,` after `id: s.id,`.

Replace `renderModule`, `renderSection`, `renderCourse` in `src/ui/course.js` with:
```js
function chip(m) {
  if (m.kind === 'label') return null;
  return h('span', { class: `chip chip-${m.modname || m.kind}` }, S.types[m.modname] || S.types.other);
}

function renderModule(m, opts) {
  if (m.kind === 'label') return h('li', { class: 'mod label' }, html('html', m.description, opts));
  const linkOnly = (m.kind === 'url' || m.kind === 'page') && m.links.length > 0;
  return h('li', { class: `mod ${m.kind}` },
    h('div', { class: 'mod-head' }, chip(m), linkOnly ? null : h('span', { class: 'mod-name' }, m.name)),
    m.unsupported ? h('small', { class: 'muted soon' }, m.soon ? S.comingSoon : S.unsupported) : null,
    m.description ? html('html small', m.description, opts) : null,
    m.links.length
      ? h('ul', { class: 'links' }, m.links.map((l) => h('li', {}, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label))))
      : null);
}

function renderSection(s, open, opts) {
  return h('details', { class: 'section unit', open },
    h('summary', {},
      s.number > 0 ? h('span', { class: 'unit-no', 'aria-hidden': 'true' }, String(s.number)) : null,
      h('span', { class: 'unit-name' }, s.name)),
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
    typeof course.progress === 'number' ? h('progress', { class: 'course-progress', max: 100, value: Math.round(course.progress) }) : null,
    offline ? h('p', { class: 'banner' }, S.offline) : null,
    body);
}
```
Append to `src/styles.css` and change `body` font-size from `16px/1.45` to `17px/1.5`:
```css
/* Unit cards and type chips */
.unit > summary { display: flex; align-items: center; gap: 12px; }
.unit-no { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); font-size: 15px; font-weight: 700; }
.unit-name { flex: 1; overflow-wrap: anywhere; }
.mod { padding: 14px 0; }
.mod-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chip { flex: none; padding: 2px 10px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); color: var(--muted); font-size: 13px; font-weight: 600; }
.chip-assign, .chip-quiz, .chip-forum { border-color: var(--accent); color: var(--accent); }
.course-progress { display: block; width: calc(100% - 32px); height: 8px; margin: 0 16px 12px; }
```

- [ ] **Step 4: Run `npm test`, expect PASS** (also confirms Task 3's tests and app tests still pass with the new module fields). Commit:
```bash
git add -A && git commit -m "feat: course page unit cards, type chips, coming-soon notes and progress"
```

---

### Task 5: Diagnostics report (redaction + collection)

**Files:**
- Create: `src/diagnostics.js`, `tests/diagnostics.test.js`
- Modify: `src/strings.js`

**Interfaces:**
- Consumes: `loadCourseList`, `api.getSiteInfo`, `api.getCourseContents`.
- Produces:
  - `shapeOf(value) -> JSON-safe`: strings -> `"<string>"`, numbers -> `"<number>"`, booleans -> `"<boolean>"`, `null` -> `null`, arrays truncated to 2 elements, objects keep only keys matching `/^[A-Za-z_][A-Za-z0-9_]{0,40}$/` (any other key becomes `"<key>"`), depth limit 6.
  - `buildReport(data) -> string` where `data = {siteInfo, source, courses, rawCourse, contents, errors}`.
  - `runDiagnostics({api, call, list?}) -> Promise<data>` (`call(fn)` is `app.js`'s renewal wrapper where `fn(session)`; `list` is an already-loaded `{courses, source, raw}`). Failed calls are recorded in `data.errors[callName] = code`; `invalidtoken` is re-thrown.
  - Strings: `diagnostics: 'Diagnostics'`, `running: 'Running checks…'`, `copyReport: 'Copy report'`, `copied: 'Copied'`, `copyHint: 'Select the text and copy it'`.

- [ ] **Step 1: Write the failing tests** `tests/diagnostics.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, buildReport, runDiagnostics } from '../src/diagnostics.js';
import { MoodleError } from '../src/api.js';

const hostile = {
  siteInfo: {
    release: '4.1.5 (Build: 20230101)', version: '2022112800', sitename: 'SECRET SITE NAME',
    fullname: 'Ana Perez', userid: 4242, username: '10000001', userprivateaccesskey: 'KEY123',
    usermaxuploadfilesize: 52428800, userquota: 104857600, usercanmanageownfiles: true,
    functions: [
      { name: 'mod_assign_save_submission', version: '1' },
      { name: 'core_files_upload', version: '1' },
      { name: 'evil name; <script>' },
      { nope: true },
      null,
    ],
  },
  source: 1,
  courses: [
    { id: 1, fullname: 'Curso Secreto de Ana', shortname: 'CSA', category: 'Español A1' },
    { id: 2, fullname: 'Otro curso', shortname: 'OC', category: 'Español A1' },
    { id: 3, fullname: 'Suelto', shortname: 'S', category: '' },
  ],
  rawCourse: { id: 1, fullname: 'Curso Secreto de Ana', courseimage: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png?token=TOK999', 'weird key https://x.y/token=1': 'v', nested: { list: ['a', 'b', 'c'] } },
  contents: [[
    { id: 1, name: 'Tema privado', modules: [
      { id: 1, modname: 'assign', name: 'Entrega de Ana', contents: [{ filename: 'nota-ana.pdf', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/x.pdf?token=TOK999' }] },
      { id: 2, modname: 'quiz', name: 'Test' },
      { id: 3, modname: 'quiz', name: 'Test 2' },
      { id: 4, modname: 'evil modname <b>', name: 'x' },
    ] },
  ]],
  errors: { core_course_get_contents: 'accessexception', 'weird call https://leak': 'bad code!' },
};

test('shapeOf keeps keys and types only, truncates arrays, redacts data-like keys', () => {
  const s = shapeOf({ a: 'secret', b: 5, c: true, d: null, e: ['x', 'y', 'z'], 'http://leak/1': 'v', f: { g: 'h' } });
  assert.deepEqual(s, { a: '<string>', b: '<number>', c: '<boolean>', d: null, e: ['<string>', '<string>'], '<key>': '<string>', f: { g: '<string>' } });
  assert.equal(shapeOf(undefined), '<unknown>');
});

test('report never contains tokens, names, ids, urls or file names', () => {
  const r = buildReport(hostile);
  for (const secret of ['SECRET SITE NAME', 'Ana', 'Perez', '4242', '10000001', 'KEY123', 'TOK999', 'http', 'nota-ana', 'Curso Secreto', 'Tema privado', 'Entrega', 'CSA', 'evil name', '<script>', 'evil modname', 'weird call', 'weird key', 'leak', 'bad code']) {
    assert.ok(!r.includes(secret), `leaked: ${secret}`);
  }
});

test('report contains the useful facts', () => {
  const r = buildReport(hostile);
  assert.match(r, /Moodle release: 4\.1\.5 \(Build: 20230101\)/);
  assert.match(r, /Category source: 1/);
  assert.match(r, /Español A1: 2 courses/);
  assert.match(r, /Other courses: 1 course\b/);
  assert.match(r, /assign x1/);
  assert.match(r, /quiz x2/);
  assert.match(r, /mod_assign_save_submission: yes/);
  assert.match(r, /mod_quiz_start_attempt: no/);
  assert.match(r, /core_files_upload: yes/);
  assert.match(r, /Web-service functions available \(2\)/);
  assert.match(r, /Max upload size: 52428800/);
  assert.match(r, /core_course_get_contents: accessexception/);
  assert.match(r, /<string>/);
});

test('report copes with an empty/missing data set and a hostile release string', () => {
  const r = buildReport({ siteInfo: { release: 'x'.repeat(200) }, source: null, courses: [], rawCourse: null, contents: [], errors: {} });
  assert.match(r, /Moodle release: <redacted>/);
  assert.match(r, /Enrolled courses: 0/);
  assert.doesNotThrow(() => buildReport({}));
});

const session = { token: 'tok', userid: 7 };
const call = async (fn) => fn(session);

test('runDiagnostics collects data, limits contents to 5 courses and records failures inline', async () => {
  const seen = [];
  const api = {
    getSiteInfo: async () => ({ release: '4.1', functions: [] }),
    getCoursesByTimeline: async () => ({ courses: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, fullname: `C${i}`, coursecategory: 'Cat' })) }),
    getCourseContents: async (token, id) => { seen.push(id); if (id === 2) throw new MoodleError('accessexception'); return [{ id, modules: [] }]; },
  };
  const d = await runDiagnostics({ api, call });
  assert.equal(d.source, 1);
  assert.equal(d.courses.length, 8);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(d.contents.length, 4);
  assert.equal(d.errors.core_course_get_contents, 'accessexception');
  assert.equal(d.rawCourse.id, 1);
});

test('runDiagnostics records a failed site info call and keeps going; invalidtoken aborts', async () => {
  const api = {
    getSiteInfo: async () => { throw new MoodleError('accessexception'); },
    getCoursesByTimeline: async () => ({ courses: [] }),
    getCourses: async () => [],
    getCourseContents: async () => [],
  };
  const d = await runDiagnostics({ api, call });
  assert.equal(d.siteInfo, null);
  assert.equal(d.errors.core_webservice_get_site_info, 'accessexception');
  const bad = { ...api, getSiteInfo: async () => { throw new MoodleError('invalidtoken'); } };
  await assert.rejects(() => runDiagnostics({ api: bad, call }), (e) => e.code === 'invalidtoken');
});

test('runDiagnostics reuses an already loaded course list', async () => {
  let listCalls = 0;
  const api = {
    getSiteInfo: async () => ({}),
    getCoursesByTimeline: async () => { listCalls += 1; return { courses: [] }; },
    getCourses: async () => { listCalls += 1; return []; },
    getCourseContents: async () => [],
  };
  const list = { courses: [{ id: 1, fullname: 'A', category: '' }], source: 3, raw: { id: 1 } };
  const d = await runDiagnostics({ api, call, list });
  assert.equal(listCalls, 0);
  assert.equal(d.source, 3);
});
```

- [ ] **Step 2: Run, expect FAIL** (`../src/diagnostics.js` missing).

- [ ] **Step 3: Implement** `src/diagnostics.js` (and add the 5 strings listed under Interfaces to `src/strings.js`)

```js
import { loadCourseList } from './courses.js';

const SAFE_TEXT = /^[\w .()+-]{1,60}$/;
const SAFE_FN = /^[a-z][a-z0-9_]{2,80}$/;
const SAFE_MOD = /^[a-z][a-z_]{1,30}$/;
const SAFE_CODE = /^[a-z][a-z_]{1,60}$/;
const SAFE_CALL = /^[a-z][a-z0-9_]{2,80}$/;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

const CHECKS = [
  'core_course_get_enrolled_courses_by_timeline_classification', 'core_course_get_categories',
  'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'mod_assign_save_submission', 'mod_assign_submit_for_grading', 'core_files_upload',
  'mod_quiz_get_quizzes_by_courses', 'mod_quiz_start_attempt', 'mod_quiz_get_attempt_data', 'mod_quiz_process_attempt',
  'mod_forum_get_forum_discussions', 'mod_forum_add_discussion', 'mod_forum_add_discussion_post',
];

export function shapeOf(v, depth = 0) {
  if (v === null) return null;
  if (Array.isArray(v)) return depth > 5 ? '<array>' : v.slice(0, 2).map((x) => shapeOf(x, depth + 1));
  switch (typeof v) {
    case 'string': return '<string>';
    case 'number': return '<number>';
    case 'boolean': return '<boolean>';
    case 'object':
      if (depth > 5) return '<object>';
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [SAFE_KEY.test(k) ? k : '<key>', shapeOf(x, depth + 1)]));
    default: return '<unknown>';
  }
}

const safeText = (v) => (typeof v === 'string' && SAFE_TEXT.test(v) ? v : '<redacted>');
const num = (v) => (Number.isFinite(v) ? String(v) : 'unknown');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function buildReport(d) {
  const info = d.siteInfo || {};
  const courses = Array.isArray(d.courses) ? d.courses : [];
  const fns = new Set((Array.isArray(info.functions) ? info.functions : [])
    .map((f) => f && f.name).filter((n) => typeof n === 'string' && SAFE_FN.test(n)));

  const cats = new Map();
  for (const c of courses) {
    const name = c.category ? String(c.category).slice(0, 80) : 'Other courses';
    cats.set(name, (cats.get(name) || 0) + 1);
  }
  const mods = new Map();
  for (const sections of Array.isArray(d.contents) ? d.contents : []) {
    for (const s of Array.isArray(sections) ? sections : []) {
      for (const m of Array.isArray(s && s.modules) ? s.modules : []) {
        const n = m && typeof m.modname === 'string' && SAFE_MOD.test(m.modname) ? m.modname : null;
        if (n) mods.set(n, (mods.get(n) || 0) + 1);
      }
    }
  }
  const errors = Object.entries(d.errors || {})
    .filter(([k]) => SAFE_CALL.test(k))
    .map(([k, v]) => `${k}: ${typeof v === 'string' && SAFE_CODE.test(v) ? v : 'error'}`);

  const lines = [
    'Aules diagnostics',
    `Moodle release: ${safeText(info.release)}`,
    `Moodle version: ${safeText(info.version)}`,
    `Max upload size: ${num(info.usermaxuploadfilesize)}`,
    `User quota: ${num(info.userquota)}`,
    `Can manage own files: ${info.usercanmanageownfiles === true ? 'yes' : info.usercanmanageownfiles === false ? 'no' : 'unknown'}`,
    `Category source: ${d.source ?? 'unknown'}`,
    `Enrolled courses: ${courses.length}`,
    'Categories:',
    ...[...cats.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([n, c]) => `  ${n}: ${plural(c, 'course', 'courses')}`),
    `Activity types (first ${Math.min(courses.length, 5)} courses):`,
    ...[...mods.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `  ${n} x${c}`),
    'Key functions the token may call:',
    ...CHECKS.map((n) => `  ${n}: ${fns.has(n) ? 'yes' : 'no'}`),
    `Web-service functions available (${fns.size}):`,
    [...fns].sort().join(', ') || '  none reported',
    'Call errors:',
    ...(errors.length ? errors.map((e) => `  ${e}`) : ['  none']),
    'Data shapes (keys and types only):',
    JSON.stringify({
      course_overview: shapeOf(d.rawCourse ?? null),
      contents_first_course: shapeOf(Array.isArray(d.contents) && d.contents[0] ? d.contents[0] : null),
    }, null, 1),
  ];
  return lines.join('\n');
}

export async function runDiagnostics({ api, call, list }) {
  const errors = {};
  const guard = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e && e.code === 'invalidtoken') throw e;
      errors[name] = (e && e.code) || 'error';
      return null;
    }
  };
  const siteInfo = await guard('core_webservice_get_site_info', () => call((s) => api.getSiteInfo(s.token)));
  const loaded = list || await guard('course_list', () => call((s) => loadCourseList({ api, token: s.token, userid: s.userid })));
  const courses = (loaded && loaded.courses) || [];
  const contents = [];
  for (const c of courses.slice(0, 5)) {
    const r = await guard('core_course_get_contents', () => call((s) => api.getCourseContents(s.token, c.id)));
    if (r) contents.push(r);
  }
  return { siteInfo, source: loaded ? loaded.source : null, courses, rawCourse: loaded ? loaded.raw : null, contents, errors };
}
```
Note: the report prints category names (institutional labels) by design; course names, ids and everything else are excluded. The test above asserts `Español A1` appears while no course names do.

- [ ] **Step 4: Run `npm test`, expect PASS.** Commit:
```bash
git add -A && git commit -m "feat: diagnostics report with allow-list redaction"
```

---

### Task 6: Diagnostics screen, app wiring, main and service worker

**Files:**
- Create: `src/ui/diagnostics.js`, `tests/diagnostics-ui.test.js`
- Modify: `src/app.js`, `src/main.js`, `sw.js`, `tests/app.test.js`

**Interfaces:**
- Consumes: `loadCourseList`, `runDiagnostics`, `buildReport`, `createFolderState`, `renderBack`, `describeError`.
- Produces:
  - `renderDiagnostics({run: () => Promise<string>, clipboard?}) -> HTMLElement` (`article.course.diagnostics`, `pre.report`, `button.copy`, `p.copy-msg`); the button copies `pre.textContent` via `clipboard.writeText`, on failure selects the text and shows `copyHint`.
  - `createApp({root, api, auth, cache, win?, folderState?})` — `folderState` defaults to an in-memory `createFolderState`. Routes: `#/` list, `#/course/<id>`, `#/diagnostics` (detail pane, `has-detail`). Header has a `a.link[href="#/diagnostics"]`.

- [ ] **Step 1: Write the failing tests**

`tests/diagnostics-ui.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { MoodleError } from '../src/api.js';

setupDom();
const { renderDiagnostics } = await import('../src/ui/diagnostics.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('shows running text, then the report, and enables Copy', async () => {
  const el = renderDiagnostics({ run: async () => 'REPORT TEXT', clipboard: { writeText: async () => {} } });
  assert.match(el.querySelector('pre.report').textContent, /Running checks/);
  assert.equal(el.querySelector('button.copy').disabled, true);
  await tick();
  assert.equal(el.querySelector('pre.report').textContent, 'REPORT TEXT');
  assert.equal(el.querySelector('button.copy').disabled, false);
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/');
});

test('Copy writes the report to the clipboard and confirms', async () => {
  const copied = [];
  const el = renderDiagnostics({ run: async () => 'ABC', clipboard: { writeText: async (t) => { copied.push(t); } } });
  await tick();
  el.querySelector('button.copy').click();
  await tick();
  assert.deepEqual(copied, ['ABC']);
  assert.equal(el.querySelector('.copy-msg').textContent, 'Copied');
});

test('when the clipboard is missing or rejects, the text is selected and a hint shown', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) {
    const el = renderDiagnostics({ run: async () => 'ABC', clipboard });
    document.body.append(el);
    await tick();
    el.querySelector('button.copy').click();
    await tick();
    assert.equal(el.querySelector('.copy-msg').textContent, 'Select the text and copy it');
    assert.equal(window.getSelection().toString(), 'ABC');
    el.remove();
  }
});

test('a failing run shows a friendly error instead of the report', async () => {
  const el = renderDiagnostics({ run: async () => { throw new MoodleError('network'); }, clipboard: undefined });
  await tick();
  assert.match(el.querySelector('pre.report').textContent, /Cannot reach Aules/);
  assert.equal(el.querySelector('button.copy').disabled, true);
});
```
Append to `tests/app.test.js` (add `import { sampleTimelineCourses } from './fixtures.js';` — added in Task 7's fixtures; to avoid ordering trouble, define it inline here instead):
```js
const timeline = [
  { id: 11, fullname: 'Gramática', shortname: 'G', coursecategory: 'Español A1', progress: 10 },
  { id: 12, fullname: 'Cultura', shortname: 'C', coursecategory: 'Español B1', progress: null },
];

test('categories from the timeline render as folders', async () => {
  const { app, root } = setup({ getCoursesByTimeline: async () => ({ courses: timeline }) }, true);
  await app.start();
  assert.equal(root.querySelectorAll('details.folder').length, 2);
  assert.equal(root.querySelectorAll('a.card').length, 2);
});

test('the header links to Diagnostics and the route shows the report without leaking the token', async () => {
  const { app, root, win } = setup({
    getCoursesByTimeline: async () => ({ courses: timeline }),
    getSiteInfo: async () => ({ release: '4.1', functions: [{ name: 'mod_assign_save_submission' }], usermaxuploadfilesize: 1000 }),
    getCourseContents: async () => [{ id: 1, modules: [{ modname: 'assign', name: 'secret', contents: [{ fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/x?token=tok' }] }] }],
  }, true);
  await app.start();
  assert.ok(root.querySelector('.pane-list a.link[href="#/diagnostics"]'));
  win.location.hash = '#/diagnostics';
  await app.showRoute();
  await tick(); await tick(); await tick();
  assert.ok(root.querySelector('.shell.has-detail'));
  const report = root.querySelector('pre.report').textContent;
  assert.match(report, /Aules diagnostics/);
  assert.match(report, /Category source: 1/);
  assert.match(report, /mod_assign_save_submission: yes/);
  assert.match(report, /assign x2/);
  assert.ok(!/tok\b|secret|Gramática/.test(report));
});

test('course page gets the course progress from the list', async () => {
  const { app, root, win } = setup({ getCoursesByTimeline: async () => ({ courses: timeline }) }, true);
  await app.start();
  win.location.hash = '#/course/11';
  await app.showRoute();
  assert.equal(root.querySelector('progress.course-progress').value, 10);
});

test('invalid token during diagnostics with nothing saved returns to login', async () => {
  const { app, root, win } = setup({
    getCoursesByTimeline: async () => ({ courses: timeline }),
    getSiteInfo: async () => { throw new MoodleError('invalidtoken'); },
  }, true);
  await app.start();
  win.location.hash = '#/diagnostics';
  await app.showRoute();
  await tick(); await tick(); await tick();
  assert.ok(root.querySelector('form.login-card'));
});
```
(The `assign x2` expectation: `getCourseContents` is called for both listed courses, each returning one assign module.)

- [ ] **Step 2: Run, expect FAIL** (`../src/ui/diagnostics.js` missing; no route/link).

- [ ] **Step 3: Implement**

`src/ui/diagnostics.js`:
```js
import { h } from './dom.js';
import { renderBack } from './course.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';

function selectAll(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function renderDiagnostics({ run, clipboard = globalThis.navigator && globalThis.navigator.clipboard }) {
  const pre = h('pre', { class: 'report', tabindex: '0' }, S.running);
  const msg = h('p', { class: 'muted copy-msg' }, '');
  const btn = h('button', {
    class: 'btn copy', type: 'button', disabled: true,
    onclick: async () => {
      try {
        await clipboard.writeText(pre.textContent);
        msg.textContent = S.copied;
      } catch {
        selectAll(pre);
        msg.textContent = S.copyHint;
      }
    },
  }, S.copyReport);
  const el = h('article', { class: 'course diagnostics' },
    h('header', { class: 'bar' }, renderBack(), h('h2', {}, S.diagnostics)), pre, btn, msg);
  run().then(
    (text) => { pre.textContent = text; btn.disabled = false; },
    (err) => { pre.textContent = describeError(err); },
  );
  return el;
}
```
`src/app.js` changes:
- Imports: `import { renderDiagnostics } from './ui/diagnostics.js'; import { loadCourseList } from './courses.js'; import { runDiagnostics, buildReport } from './diagnostics.js'; import { createFolderState } from './folders.js'; import { createMemoryStorage } from './storage.js';`
- Signature: `createApp({ root, api, auth, cache, win = globalThis.window, folderState = createFolderState(createMemoryStorage()) })`; add `let lastList = null;`.
- Replace the `route` helper with:
```js
  const view = () => {
    const hash = win.location.hash;
    if (hash === '#/diagnostics') return { type: 'diagnostics' };
    const m = /^#\/course\/(\d+)$/.exec(hash);
    return m ? { type: 'course', id: Number(m[1]) } : { type: 'list' };
  };
  const route = () => {
    const v = view();
    return v.type === 'course' ? v.id : null;
  };
```
- In `renderList`, header becomes:
```js
      h('header', { class: 'bar' },
        h('h1', {}, S.courses),
        h('a', { class: 'link', href: '#/diagnostics' }, S.diagnostics),
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout)),
```
and the list call: `renderCourseList({ courses, token, selectedId: route(), folderState })`.
- In `loadCourses` replace the fetch line with:
```js
      const res = await call((s) => loadCourseList({ api, token: s.token, userid: s.userid }));
      if (auth.epoch() !== epoch) return false; // signed out meanwhile: drop the result
      courses = res.courses;
      lastList = res;
```
(delete the old `const fetched ...`/`courses = fetched;` lines; keep `cache.set('courses', courses); offline = false;`). In the cached-fallback branch also set `lastList = null;`. In `logout` also reset `lastList = null;`.
- In `showRoute`, replace `const id = route();`/`shell.classList.toggle('has-detail', id !== null);` with:
```js
    const v = view();
    const id = v.type === 'course' ? v.id : null;
    shell.classList.toggle('has-detail', v.type !== 'list');
```
and, right after `renderList();`, insert:
```js
    if (v.type === 'diagnostics') {
      clear(detailPane).append(renderDiagnostics({
        run: async () => {
          try {
            return buildReport(await runDiagnostics({ api, call, list: lastList }));
          } catch (err) {
            if (handleFatal(err)) return '';
            throw err;
          }
        },
      }));
      return;
    }
```
(the existing `if (id === null) { ... placeholder }` follows). In the final `renderCourse({...})` call change `course:` to include progress: `course: { id, fullname: info ? info.fullname : '', progress: info ? info.progress : null, sections: buildCourse(sections, live.token) },`.

`src/main.js`: add `import { createFolderState } from './folders.js';` and pass `folderState: createFolderState(storage),` in `createApp({...})`.

`sw.js`: set `const VERSION = "v2";` and add to SHELL (keep alphabetical position): `"./src/courses.js"`, `"./src/diagnostics.js"`, `"./src/folders.js"`, `"./src/ui/diagnostics.js"`.

- [ ] **Step 4: Run `npm test`, expect PASS** (the shell test confirms every new module is in the SW list). Commit:
```bash
git add -A && git commit -m "feat: diagnostics screen, category-aware app wiring and service worker update"
```

---

### Task 7: Preview data, README and visual verification

**Files:**
- Modify: `tests/fixtures.js`, `tools/preview.js`, `README.md`

**Interfaces:**
- Produces: `sampleTimelineCourses` fixture export (4 courses in 2 categories + 1 uncategorised); preview app showing folders and a working Diagnostics screen without network.

- [ ] **Step 1: Add preview fixtures and wire the preview**

Append to `tests/fixtures.js`:
```js
export const sampleTimelineCourses = [
  { id: 11, fullname: 'Gramática A1', shortname: 'ES-GRA-A1', coursecategory: 'Español A1', progress: 40 },
  { id: 12, fullname: 'Vocabulario A1', shortname: 'ES-VOC-A1', coursecategory: 'Español A1', progress: 10 },
  { id: 13, fullname: 'Cultura y sociedad', shortname: 'ES-CUL-B1', coursecategory: 'Español B1', progress: null },
  { id: 14, fullname: 'Conversación B1', shortname: 'ES-CON-B1', coursecategory: 'Español B1', progress: 75 },
  { id: 15, fullname: 'Taller de escritura', shortname: 'ES-TAL', coursecategory: '', progress: null },
];
```
In `tools/preview.js` import `sampleTimelineCourses` too and change the demo `api` to:
```js
const api = {
  requestToken: async () => 'demo',
  getSiteInfo: async () => ({
    release: '4.1 (demo)', version: '2022112800', usermaxuploadfilesize: 52428800, usercanmanageownfiles: true,
    functions: [{ name: 'core_course_get_categories' }, { name: 'mod_assign_save_submission' }],
  }),
  getCoursesByTimeline: async () => ({ courses: sampleTimelineCourses }),
  getCourses: async () => sampleCourses,
  getCourseContents: async () => sampleSections,
};
```
and pass `folderState: createFolderState(createMemoryStorage())` (import `createFolderState` from `../src/folders.js`) to `createApp`.

- [ ] **Step 2: Update `README.md`**

Under "How it works" add two bullets: course categories (timeline call first, then enrolled courses plus `core_course_get_categories`, then flat) and the Diagnostics screen ("menu -> Diagnostics -> Copy report; the report lists the Moodle version, which write functions your token may call, categories and activity types, with no tokens, names, ids or URLs"). Under "Run locally" mention `tools/preview.html` now shows folders and Diagnostics. Add a short "What is coming" list: Exercises (assignments: text + file upload), quizzes, forums.

- [ ] **Step 3: Run `npm test`, expect PASS.**

- [ ] **Step 4: Visual check**

Run (background): `npm run serve`. In the Browser pane open `http://localhost:8080/tools/preview.html`:
- `mobile` preset (375x812): two category folders + "Other courses" are shown open (3 folders), counts visible, no horizontal scroll; collapsing a folder and reloading keeps it collapsed only if state persists (preview uses memory state, so skip that); search `gram` hides other folders and opens the match; tapping a course shows one pane with unit cards, numbered units (General has no number), chips, "Coming soon" on the forum, "Not available" on the glossary, course progress bar; header shows "Diagnostics" and "Sign out" without wrapping off-screen.
- Tap Diagnostics: report renders; Copy button works or shows the select hint; Back returns.
- `tablet` preset (768x1024): two columns, folder list left, course right, selected card highlighted.
- Dark scheme readable. Capture screenshots; fix any layout bug in `src/styles.css`, re-run `npm test`. Restore `desktop` preset and stop the server.

- [ ] **Step 5: Commit** (do **not** push):
```bash
git add -A && git commit -m "docs: README and categorised preview data for sub-project 1"
```
- [ ] **Step 6: Hand off to the user:** summarise the change, state that nothing is pushed, and ask permission to push to `danilhatz/aules` (Pages redeploys in about a minute; the service worker `VERSION` is already `v2`, so installed phones refresh on next open). Remind them to open Diagnostics on their phone and paste the report so sub-project 2 (assignments) can be designed from real data.

---

## Self-Review (done)

- **Spec coverage:** category folders with source order 1/2/3 and fallbacks (Tasks 1-2), grouping/sorting/uncategorised/flat-when-one-folder (2-3), collapsible folders with persisted state and cross-folder search forcing open (3), tap course -> existing selected-course route + `aria-current` (3, 6), cached grouped result via existing `courses` cache key (6), unit cards/type chips/coming soon/progress/larger targets (4), Diagnostics screen: site info facts, function-name checklist, category tree, module type counts, redacted shapes, inline call failures, Copy with clipboard fallback, never leaks (5-6), read-only (constraint), security tests with hostile fixtures (5), phone/iPad visual check (7). No gaps found.
- **Placeholders:** none; each code step shows the full code or the exact edit.
- **Type consistency:** `Course` shape `{id, fullname, shortname, progress, image, category}` is produced by `normalizeCourse` (Task 2) and consumed by `groupCourses`, `renderCourseList` (3) and `app.js` (`info.progress`, 6). `loadCourseList` returns `{courses, source, raw}` consumed by `app.js` (`lastList`) and `runDiagnostics(list)` (5-6). `ViewModule.modname/soon` and `ViewSection.number` defined in Task 4 and used only in `ui/course.js`. `folderState.get/set` identical in Tasks 3 and 6. `call(fn)` signature `fn(session)` matches `runDiagnostics`.
- **Review Focus coverage:** 1 -> Task 2 tests (fallback, empty, non-array, missing function, fatal propagation); 2 -> Tasks 2-3 (accent sorting, hostile name as text); 3 -> Task 3 search test; 4 -> Task 5 hostile fixtures; 5 -> Tasks 1-2 (rewrite, data:/javascript: dropped).
