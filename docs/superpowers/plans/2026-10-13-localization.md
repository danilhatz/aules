# Ukrainian Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the app's own text in Ukrainian or English, following the phone language by default, with an in-app switch (Auto / English / Українська) that is saved on the device.

**Architecture:** The English strings move to `src/lang/en.js`; `src/lang/uk.js` holds the Ukrainian ones with identical keys. `src/strings.js` keeps exporting `STRINGS` (so no screen changes) and picks the language once at load via `src/i18n.js` (saved choice, then `navigator.languages`, then English), with Ukrainian merged over English so a missing key shows English. A `<select>` switch saves the choice and reloads the page.

**Tech Stack:** Vanilla ES modules, `node:test` + `jsdom`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-localization-design.md`

## Global Constraints

- Languages: `en` and `uk` only; anything else falls back to `en`. Spanish is not added.
- Preference key in `localStorage`: `aules.lang`, values `auto` | `en` | `uk`. Not removed at sign-out; `cache.clear()` only removes its own indexed keys, so it is safe.
- Storage access never throws; failures mean "auto".
- Changing the language saves the choice and reloads the page; no in-place redraw.
- The Diagnostics report text stays English (`src/diagnostics.js` is not touched). Diagnostics screen titles/buttons come from `STRINGS` and are translated.
- Course sorting keeps `Intl.Collator('es')` (course names are Spanish).
- No plural code: the audit shows no count-bearing UI string outside Diagnostics (YAGNI; the spec allows zero).
- All user-visible app text stays in the language files; `STRINGS` shape and names stay unchanged for existing code.
- Test runner: `npm test` (`node --test`). Never push without the user's explicit OK.
- Every app-file change needs a `VERSION` bump in `sw.js` and new files in its `SHELL` list (tests enforce this); `npm run lock-shell` re-records `shell.lock.json` at release.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

1. Phone language `uk-UA`, `uk`, `UK` → Ukrainian; `ru`, `pl`, `en-GB`, empty list, non-array → sensible (English, or English via region). Pinned in Task 1.
2. Saved preference is garbage (`"xx"`, `null`, JSON) or storage throws on read/write → app still starts, treats as auto. Pinned in Task 1.
3. A Ukrainian key is missing at runtime → English text shown, never `undefined`. Pinned in Task 2.
4. A Ukrainian translation drops or renames a `{placeholder}` (`{min}`, `{done}`, `{total}`) → quiz text would print raw braces. Pinned in Task 3.
5. Switch is used while the user is signed out or signed in → choice survives sign-out and reload; session and drafts are untouched by the reload. Pinned in Task 4.

---

### Task 1: Language detection and preference (`src/i18n.js`)

**Files:**
- Create: `src/i18n.js`
- Test: `tests/i18n.test.js`

**Interfaces:**
- Produces:
  - `LANGUAGES = ['en', 'uk']`, `PREF_KEY = 'aules.lang'`
  - `resolveLanguage(pref, navigatorLanguages) -> 'en' | 'uk'`
  - `readPreference(storage) -> 'auto' | 'en' | 'uk'` (never throws; unknown → `'auto'`)
  - `savePreference(storage, value) -> boolean` (true if stored; `'auto'` removes the key; invalid value or storage failure → false)
  - `deviceStorage() -> localStorage | null` (never throws)

- [ ] **Step 1: Write the failing test**

Create `tests/i18n.test.js`:

```js
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
  assert.equal(resolveLanguage(undefined, ['ru-RU', 'uk-UA']), 'uk'); // first *supported* entry
});

test('unsupported, empty or malformed input falls back to English', () => {
  assert.equal(resolveLanguage('auto', ['ru', 'pl']), 'en');
  assert.equal(resolveLanguage('auto', []), 'en');
  assert.equal(resolveLanguage('auto', undefined), 'en');
  assert.equal(resolveLanguage('auto', 'uk'), 'en'); // not an array
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
  assert.equal(deviceStorage(), null); // plain Node: no localStorage global
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/i18n.test.js`
Expected: FAIL — cannot find module `../src/i18n.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/i18n.js`:

```js
export const LANGUAGES = ['en', 'uk'];
export const PREF_KEY = 'aules.lang';

export function resolveLanguage(pref, navigatorLanguages) {
  if (LANGUAGES.includes(pref)) return pref;
  if (Array.isArray(navigatorLanguages)) {
    for (const tag of navigatorLanguages) {
      if (typeof tag !== 'string') continue;
      const primary = tag.toLowerCase().split('-')[0];
      if (LANGUAGES.includes(primary)) return primary;
    }
  }
  return 'en';
}

export function readPreference(storage) {
  try {
    const v = storage && storage.getItem(PREF_KEY);
    return LANGUAGES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function savePreference(storage, value) {
  if (!storage || (value !== 'auto' && !LANGUAGES.includes(value))) return false;
  try {
    if (value === 'auto') storage.removeItem(PREF_KEY);
    else storage.setItem(PREF_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function deviceStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/i18n.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.js tests/i18n.test.js sw.js
git commit -m "feat: language detection and saved preference

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Before committing: `shell.test.js` requires every file under `src/` to be in the service worker `SHELL`, and the lock test requires a `VERSION` bump when app files change. So in `sw.js` add `"./src/i18n.js",` to `SHELL` (alphabetical, after `./src/folders.js`) and change `const VERSION = "v6";` to `"v7"`. Run `npm test`; it must be green except possibly `shell-lock.test.js` (the lock is re-recorded in Task 5, so that one failure is expected until then). Add `sw.js` to the commit.

---

### Task 2: Language packs and the new `strings.js`

**Files:**
- Move: `src/strings.js` → `src/lang/en.js` (use `git mv`, then edit the header and add 4 keys)
- Create: `src/lang/uk.js` (temporary empty pack; filled in Task 3)
- Rewrite: `src/strings.js`
- Test: `tests/strings.test.js`

**Interfaces:**
- Consumes: `resolveLanguage`, `readPreference`, `deviceStorage` from `src/i18n.js` (Task 1).
- Produces:
  - `en` (named export of `src/lang/en.js`), `uk` (named export of `src/lang/uk.js`)
  - `buildStrings(lang, packs = { en, uk }) -> object` — English with the pack for `lang` deep-merged on top
  - `STRINGS` — `buildStrings(LANG)`, same shape as before plus keys `language`, `langAuto`, `langEn`, `langUk`
  - `LANG` — the active code, `'en' | 'uk'`

- [ ] **Step 1: Move the English strings**

```bash
mkdir -p src/lang
git mv src/strings.js src/lang/en.js
```

Edit `src/lang/en.js`: change the first line `export const STRINGS = {` to `export const en = {`, and add these four keys right after `appName: 'Aules',`:

```js
  language: 'Language',
  langAuto: 'Auto (phone)',
  langEn: 'English',
  langUk: 'Українська',
```

- [ ] **Step 2: Create the temporary Ukrainian pack**

Create `src/lang/uk.js` (replaced completely in Task 3; empty on purpose so the merge falls back to English meanwhile):

```js
export const uk = {};
```

- [ ] **Step 3: Write the failing test**

Create `tests/strings.test.js`:

```js
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
  assert.equal(s.errors.invalidlogin, en.errors.invalidlogin); // missing key falls back to English
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/strings.test.js`
Expected: FAIL — `buildStrings` is not exported (the old `strings.js` was moved away; the import fails).

- [ ] **Step 5: Write the implementation**

Create `src/strings.js`:

```js
import { en } from './lang/en.js';
import { uk } from './lang/uk.js';
import { resolveLanguage, readPreference, deviceStorage } from './i18n.js';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Returns a new object: `base` with every key that `over` also defines replaced (nested groups merged key by key).
function merge(base, over) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = isObject(v) ? merge(v, isObject(over && over[k]) ? over[k] : {}) : (over && typeof over[k] === 'string' && over[k] ? over[k] : v);
  }
  return out;
}

export function buildStrings(lang, packs = { en, uk }) {
  return lang === 'en' || !packs[lang] ? merge(packs.en, {}) : merge(packs.en, packs[lang]);
}

const phone = globalThis.navigator && globalThis.navigator.languages;
export const LANG = resolveLanguage(readPreference(deviceStorage()), Array.isArray(phone) ? phone : []);
export const STRINGS = buildStrings(LANG);
```

- [ ] **Step 6: Run the new test, then the whole suite**

Run: `node --test tests/strings.test.js` — Expected: PASS.
Run: `npm test` — Expected: everything passes except possibly `shell.test.js` (new files not yet in `SHELL`) — if so add `./src/i18n.js`, `./src/lang/en.js`, `./src/lang/uk.js` to `SHELL` in `sw.js` (keep it alphabetical like the rest) and bump `VERSION` to `"v7"`, then rerun until green. (`shell-lock.test.js` will fail only if the lock was re-recorded at a different state; do NOT run `lock-shell` yet — see Task 5.)

- [ ] **Step 7: Commit**

```bash
git add -A src tests sw.js
git commit -m "feat: language packs, merged strings with English fallback

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Ukrainian translation and parity tests

**Files:**
- Rewrite: `src/lang/uk.js`
- Test: `tests/lang.test.js`

**Interfaces:**
- Consumes: `en` (Task 2).
- Produces: `uk` — a full pack with exactly the key tree of `en`.

- [ ] **Step 1: Write the failing test**

Create `tests/lang.test.js`:

```js
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
    assert.match(v, /[\u0400-\u04FF]/, k);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lang.test.js`
Expected: FAIL — key sets differ (the Task 2 pack is empty).

- [ ] **Step 3: Write the translation**

Replace `src/lang/uk.js` completely:

```js
export const uk = {
  appName: 'Aules',
  language: 'Мова',
  langAuto: 'Авто (як у телефоні)',
  langEn: 'English',
  langUk: 'Українська',
  signIn: 'Увійти',
  username: 'Номер користувача',
  password: 'Пароль',
  courses: 'Мої курси',
  search: 'Пошук курсів',
  back: 'Курси',
  offline: 'Офлайн: показано збережені дані',
  logout: 'Вийти',
  section: 'Розділ',
  saveNote: 'Ваш логін зберігається на цьому пристрої в зашифрованому вигляді, щоб застосунок міг сам поновлювати сеанс. «Вийти» видаляє його.',
  unsupported: 'Поки недоступно в застосунку',
  backToCourse: 'Курс',
  yourAnswer: 'Ваша відповідь',
  yourSubmission: 'Ваша робота',
  saveDraft: 'Зберегти чернетку',
  submitForGrading: 'Надіслати на оцінювання',
  submit: 'Надіслати',
  confirmSubmit: 'Так, надіслати',
  cancel: 'Скасувати',
  confirmSubmitText: 'Надіслати на оцінювання? Після цього змінити роботу може не вийти.',
  confirmSendText: 'Надіслати відповідь зараз?',
  nothingToSend: 'Спочатку напишіть відповідь або додайте файл.',
  replaceFormatted: 'Замінити простим текстом',
  formattedNote: 'Ця відповідь має форматування із сайту. Редагування тут замінить його простим текстом.',
  addFiles: 'Додати файли або фото',
  remove: 'Видалити',
  fileTooBig: 'Файл завеликий',
  tooManyFiles: 'Забагато файлів',
  updating: 'Оновлення…',
  uploadUnavailable: 'Завантаження файлів із цього застосунку недоступне для вашого облікового запису.',
  uploadUntested: 'Завантаження файлів ще не ввімкнено. Відкрийте «Діагностика» і спочатку запустіть «Перевірити завантаження».',
  formattedBlocksFiles: 'Ця відповідь має форматування із сайту. Натисніть «Замінити простим текстом» перед зміною файлів або змініть файли на сайті.',
  staleDraft: 'У вас є незбережений текст із попереднього візиту',
  restore: 'Відновити',
  discard: 'Відхилити',
  savedDraft: 'Чернетку збережено.',
  submittedOk: 'Надіслано.',
  unconfirmed: 'Не вдалося підтвердити — екран оновлено, щоб ви могли перевірити стан.',
  noDueDate: 'Без терміну',
  states: { notsubmitted: 'Не надіслано', draft: 'Чернетка', submitted: 'Надіслано', graded: 'Оцінено' },
  readonly: {
    team: 'Групові роботи поки не підтримуються в застосунку.',
    nosubmissions: 'Це завдання не передбачає онлайн-здачі.',
    noplugins: 'Це завдання не приймає онлайн-відповідей.',
    notopen: 'Приймання робіт ще не відкрито.',
    locked: 'Приймання робіт заблоковано.',
    cutoff: 'Термін минув.',
    submitted: 'Надіслано. Попросіть викладача знову відкрити роботу, якщо потрібно її змінити.',
    notallowed: 'Ви не можете редагувати цю роботу.',
    updating: 'Перевірка змін…',
  },
  offlineNoEdit: 'Ви офлайн. Редагування буде доступне, коли з’явиться з’єднання.',
  gradeLabel: 'Оцінка',
  feedbackLabel: 'Відгук',
  assignNotFound: 'Це завдання не знайдено в курсі.',
  testUpload: 'Перевірити завантаження',
  testing: 'Перевірка…',
  backToQuiz: 'Тест',
  quizStart: 'Почати спробу',
  quizContinue: 'Продовжити спробу',
  quizReview: 'Перегляд',
  quizFinish: 'Завершити спробу',
  quizSave: 'Зберегти',
  quizPrev: 'Назад',
  quizNext: 'Далі',
  quizSubmitNow: 'Надіслати зараз',
  confirmStart: 'Почати нову спробу? Це використає одну спробу.',
  confirmStartTime: 'Після початку у вас буде {min} хв.',
  confirmStartYes: 'Так, почати',
  quizChecking: 'Перевірка тесту…',
  quizUnsupported: 'Цей тест потребує сайту Aules.',
  quizTypes: 'Типи запитань, які застосунок не може показати:',
  quizRules: 'Правила доступу, які застосунок не може обробити:',
  quizPreflight: 'Перед початком цей тест просить додаткового підтвердження.',
  quizOverdue: 'Цю спробу прострочено. Завершіть її на сайті Aules.',
  quizBlocked: 'Зараз ви не можете почати нову спробу.',
  quizUnknown: 'Зараз не вдалося перевірити цей тест.',
  openInAules: 'Відкрити в Aules',
  quizAttempts: 'Ваші спроби',
  noAttempts: 'Спроб ще немає',
  attemptLabel: 'Спроба',
  quizStates: { inprogress: 'Триває', overdue: 'Прострочено', finished: 'Завершено', abandoned: 'Залишено', unknown: 'Невідомо' },
  bestGradeLabel: 'Найкраща оцінка',
  timeLimitLabel: 'Ліміт часу',
  attemptsAllowedLabel: 'Дозволено спроб',
  unlimited: 'Без обмежень',
  minutes: 'хв',
  closesLabel: 'Закривається',
  closedLabel: 'Закрито',
  opensLabel: 'Відкривається',
  finishedMsg: 'Спробу завершено.',
  savedMsg: 'Збережено.',
  timeLeft: 'Залишилось часу (приблизно)',
  timerMissing: 'У цього тесту є ліміт часу, але таймер не вдалося завантажити. Стежте за часом самі або завершіть тест на сайті Aules.',
  timeUp: 'Час вийшов. Надішліть відповіді зараз.',
  summaryText: 'Ви відповіли на {done} із {total} запитань. Після надсилання змінити відповіді не можна.',
  summaryUnknown: 'Після надсилання змінити відповіді не можна.',
  attemptUnsupported: 'У цій спробі є типи запитань, які застосунок не може показати. Продовжте на сайті Aules.',
  reviewTitle: 'Перегляд',
  reviewGrade: 'Оцінка',
  quizNotFound: 'Цей тест не знайдено в курсі.',
  diagnostics: 'Діагностика',
  running: 'Виконуються перевірки…',
  copyReport: 'Копіювати звіт',
  copied: 'Скопійовано',
  copyHint: 'Виділіть текст і скопіюйте його',
  unit: 'Блок',
  comingSoon: 'Скоро',
  types: { page: 'Читання', resource: 'Файл', folder: 'Папка', url: 'Посилання', assign: 'Завдання', quiz: 'Тест', forum: 'Форум', other: 'Активність' },
  loading: 'Завантаження…',
  empty: 'Курсів не знайдено',
  uncategorised: 'Інші курси',
  noContent: 'У цьому курсі немає матеріалів',
  retry: 'Повторити',
  pickCourse: 'Оберіть курс',
  errors: {
    invalidlogin: 'Неправильний номер користувача або пароль.',
    invalidtoken: 'Ваш сеанс завершився. Увійдіть знову.',
    network: 'Немає зв’язку з Aules. Перевірте з’єднання.',
    badresponse: 'Aules надіслав неочікувану відповідь.',
    notoken: 'Aules не видав токен доступу для цього облікового запису.',
    servicenotavailable: 'Мобільний сервіс не ввімкнено для цього облікового запису.',
    unknown: 'Щось пішло не так.',
    retry: 'Ваш сеанс поновлено. Натисніть ще раз.',
    keepfailed: 'Не вдалося знову прикріпити один із ваших файлів. Нічого не збережено.',
    nochanges: 'Поки що нічого надсилати.',
    formattedblocksfiles: 'Ця відповідь має форматування із сайту, тож файли тут змінити не можна. Спочатку замініть її простим текстом.',
    nodraft: 'Не вдалося підготувати зміну файлів. Нічого не збережено.',
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lang.test.js tests/strings.test.js`
Expected: PASS. If "still English" or "key sets differ" fails, compare against `src/lang/en.js` — the keys must match exactly.

- [ ] **Step 5: Commit**

```bash
git add src/lang/uk.js tests/lang.test.js
git commit -m "feat: Ukrainian translation with parity tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The language switch on the login screen and the course-list header

**Files:**
- Create: `src/ui/langswitch.js`
- Modify: `src/ui/login.js` (add the switch under the form), `src/app.js:150-157` (`renderList` header), `src/styles.css` (small style)
- Test: `tests/langswitch.test.js`

**Interfaces:**
- Consumes: `readPreference`, `savePreference`, `deviceStorage` (Task 1); `STRINGS` keys `language`, `langAuto`, `langEn`, `langUk` (Task 2); `h` from `src/ui/dom.js`.
- Produces: `renderLangSwitch({ storage = deviceStorage(), reload = () => globalThis.location.reload() }) -> HTMLElement` — a `<label class="lang-switch">` containing a `<select>` with options `auto`, `en`, `uk`; selected = saved choice.

- [ ] **Step 1: Write the failing test**

Create `tests/langswitch.test.js`:

```js
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
  assert.ok(el.querySelector('label') || el.tagName === 'LABEL');
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
  const el = renderLangSwitch({ storage, reload: () => { reloads += 1; } });
  const sel = el.querySelector('select');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/langswitch.test.js`
Expected: FAIL — cannot find `../src/ui/langswitch.js`.

- [ ] **Step 3: Write the switch**

Create `src/ui/langswitch.js`:

```js
import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { readPreference, savePreference, deviceStorage } from '../i18n.js';

export function renderLangSwitch({ storage = deviceStorage(), reload = () => globalThis.location.reload() } = {}) {
  const current = readPreference(storage);
  const option = (value, label) => h('option', { value, selected: value === current }, label);
  const select = h('select', {
    'aria-label': S.language,
    onchange: () => {
      if (savePreference(storage, select.value)) reload(); // reload only when the choice was really stored
    },
  }, option('auto', S.langAuto), option('en', S.langEn), option('uk', S.langUk));
  select.value = current;
  return h('label', { class: 'lang-switch' }, h('span', {}, S.language), select);
}
```



- [ ] **Step 4: Put the switch on the login screen and in the header**

In `src/ui/login.js` add the import after the `describeError` import:

```js
import { renderLangSwitch } from './langswitch.js';
```

and change the last line of `renderLogin` from `return h('div', { class: 'login' }, form);` to:

```js
  return h('div', { class: 'login' }, form, renderLangSwitch());
```

In `src/app.js` add near the other `./ui/` imports:

```js
import { renderLangSwitch } from './ui/langswitch.js';
```

and in `renderList` add the switch to the header, after the Sign out button:

```js
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout),
        renderLangSwitch()),
```

(The surrounding `h('header', { class: 'bar' }, ...)` call keeps its closing parenthesis; only the last child is added.)

Add to `src/styles.css` after the `.link` rule:

```css
.lang-switch { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
.lang-switch select { font: inherit; font-size: 16px; min-height: 44px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); padding: 0 8px; max-width: 150px; }
.login > .lang-switch { justify-content: center; margin-top: 12px; }
.bar .lang-switch span { display: none; }
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/langswitch.test.js` — Expected: PASS.
Run: `npm test` — Expected: all green (app tests render the list with the switch; storage is `null` in Node so it shows Auto).

- [ ] **Step 6: Check it at phone width**

Run `npm run serve`, open the preview (`tools/preview.html`) at 375 px wide (browser pane `resize_window` preset mobile). Confirm: login shows the switch centred under the form; after "login" the course-list header fits on one line (title, Diagnostics, Sign out, the select) without horizontal scroll; choosing Українська reloads and the text is Ukrainian. If the header overflows, shorten by hiding the label (already hidden in `.bar`) and lower `max-width` of the select to 110px. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: language switch on login and course-list header

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dates follow the chosen language, `<html lang>`, and release housekeeping

**Files:**
- Modify: `src/app.js:38` (default `locale`), `src/main.js` (set `document.documentElement.lang`), `sw.js` (`SHELL`, `VERSION`), `README.md`, `shell.lock.json` (via the tool), memory file
- Test: `tests/app.test.js` (add one test), `tests/shell.test.js` runs unchanged

**Interfaces:**
- Consumes: `LANG` from `src/strings.js` (Task 2); `renderLangSwitch` (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `tests/app.test.js`:

```js
test('without an explicit locale the app formats dates in the active app language', async () => {
  const { LANG } = await import('../src/strings.js');
  assert.equal(LANG, 'en'); // plain Node
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /locale = LANG\b/);
  assert.doesNotMatch(src, /navigator\.language/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/app.test.js`
Expected: FAIL — `app.js` still defaults `locale` to `navigator.language`.

- [ ] **Step 3: Implement**

In `src/app.js` change the strings import to also take `LANG`:

```js
import { STRINGS as S, LANG } from './strings.js';
```

and replace the `locale` default (line 38):

```js
  locale = LANG,
```

In `src/main.js` add after the imports (before `const storage`):

```js
import { LANG } from './strings.js';

document.documentElement.lang = LANG;
```

- [ ] **Step 4: Audit for leftover hard-coded text and plural strings**

Run:

```bash
grep -rnE "textContent = ['\"\`][A-Za-z]|h\('[a-z0-9]+', \{[^}]*\}, ['\"\`][A-Z]" src | grep -v "^src/diagnostics.js"
grep -rn "plural" src | grep -v "^src/diagnostics.js"
```

Expected: no output (Diagnostics report text is intentionally English). If any user-visible literal appears, move it into `src/lang/en.js`, add its translation to `src/lang/uk.js`, and use `S.<key>`.

- [ ] **Step 5: Shell list, version, lock**

In `sw.js` make sure `SHELL` contains `./src/i18n.js`, `./src/lang/en.js`, `./src/lang/uk.js` and `./src/ui/langswitch.js` (and still `./src/strings.js`). Set `const VERSION = "v7";` (or leave "v7" if Task 2 already bumped it). Then:

```bash
npm test
npm run lock-shell
npm test
```

Expected: first `npm test` all green except `shell-lock.test.js` (the hash changed); after `lock-shell`, all green.

- [ ] **Step 6: README and memory**

In `README.md` add a short "Language" section: the app follows the phone language (English or Ukrainian), the switch is on the login screen and the course-list header, texts live in `src/lang/en.js` and `src/lang/uk.js` and a test keeps their keys identical, Aules' own content is not translated, and how to add a language (new `src/lang/xx.js`, add the code to `LANGUAGES` in `src/i18n.js`, a pack entry in `src/strings.js`, an option in `src/ui/langswitch.js`, and its name key in both language files).

Update `C:\Users\danil\.claude\projects\C--aula\memory\project-aules-roadmap.md`: step 2 and 3 text → assignments and quizzes shipped (pushed `b05d5ed`), forums skipped by the user's decision (2026-10-13), localization built (decisions: English + Ukrainian, follow phone + in-app switch). Leave `MEMORY.md` line as is, or update its hook to mention the localization status.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: dates and html lang follow the app language; lock app files at v7

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Hand off for the user's push decision**

Run a credential scan the same way as for earlier releases (search the diff for the user's number/password patterns), report `npm test` results and the phone-width check, and ask the user before pushing. After an OK: `git push origin main`, wait for the Pages build to report `built <HEAD>`, and tell the user to close and reopen the app twice to get `v7`.
