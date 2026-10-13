# Ukrainian localization — design

Status: draft for review. Sub-project 4 (the last one). Forums are skipped for now by the user's decision.

## Goal

The app's own English text gets a Ukrainian version. The app follows the phone's language by default, and a switch inside the app overrides it. Content that comes from Aules (course names, instructions, feedback, Moodle error messages, quiz questions) is shown as Aules sends it; the app cannot translate it.

## Decisions (agreed with the user)

- Languages: English (`en`) and Ukrainian (`uk`). Any other phone language falls back to English. Spanish is not added now; the structure makes it a one-file addition later.
- Default: follow the phone (`navigator.languages`, first match). Override: a switch with three options, *Auto (phone)*, *English*, *Українська*, saved on the device.
- Changing the language saves the choice and reloads the page. No screen is redrawn in place.

## Non-goals

- Translating Aules content or Moodle messages.
- Translating the Diagnostics report. It is a technical report the user pastes to the developer, so it stays in English. The Diagnostics screen's own buttons and titles are translated like any other UI.
- Right-to-left support, more languages, translating `manifest.webmanifest`.

## Design

### Files

| File | Role |
|---|---|
| `src/lang/en.js` | The current `STRINGS` object, unchanged in content. Default export `en`. |
| `src/lang/uk.js` | Ukrainian translation with exactly the same keys and `{placeholders}`. Default export `uk`. |
| `src/i18n.js` | Pure helpers: `resolveLanguage(preference, navigatorLanguages)`, `readPreference(storage)`, `savePreference(storage, value)`, `pluralForm(lang, n)`, and constants `LANGUAGES = ['en', 'uk']`, `PREF_KEY = 'aules.lang'`. |
| `src/strings.js` | Keeps its public shape: `export const STRINGS`. Picks `en` or `uk` once, at module load, using `i18n.js`. Also exports `LANG` (the active code). |
| `src/ui/langswitch.js` | A small `<select>` control (Auto / English / Українська). On change it calls `savePreference` then `location.reload()`. |

Every existing `import { STRINGS as S } from './strings.js'` keeps working, so the UI code needs no change except the places listed below. In Node tests there is no `localStorage` or `navigator`, so `strings.js` resolves to English and existing tests are untouched.

### Language resolution

`resolveLanguage(pref, langs)`:
1. If `pref` is `en` or `uk`, use it.
2. Otherwise (`auto`, missing, garbage) take the first entry of `langs` whose primary subtag (`uk-UA` → `uk`) is supported.
3. Otherwise `en`.

Reading the saved preference never throws: storage failures (private window, blocked storage) mean "auto".

### Where the switch appears

- Login screen, under the form, so the language can be changed before signing in.
- Courses list header, next to Sign out.

The preference key is not an Aules credential or cache entry and is not removed at sign-out: it is a device setting and the language should not reset when the user signs out.

### Things that are not plain strings

- **Placeholders** (`{min}`, `{done}`, `{total}`) stay as they are; Ukrainian text may reorder them.
- **Plurals:** the course-count style strings in the app UI use `Intl.PluralRules(LANG)`. English needs one/other, Ukrainian one/few/many/other. Plural strings become small objects (`{ one, few, many, other }`) in the language files, with `pluralForm` choosing the key. Only strings that actually show a count get this; the audit during implementation lists them (currently none outside Diagnostics, which stays English, so this may turn out to be zero strings, and then no plural code is written).
- **Dates and relative times:** `formatDue` and the draft timestamp already take a `locale` argument. `app.js` passes `LANG` instead of `navigator.language`, so dates match the chosen language, not the phone's.
- **Sorting:** course sorting keeps `Intl.Collator('es')` because course names are Spanish.
- **`<html lang>`:** set to `LANG` at startup from `main.js`. The static `lang="en"` in `index.html` stays as the pre-JS default.
- **Error messages:** `describeError` already maps codes through `S.errors`, so those translate automatically. Unknown Moodle messages are appended as sent.

### Translation quality

All Ukrainian text is written plainly for a student. Terms are chosen once and used consistently: *Завдання* (assignment/exercise), *Тест* (quiz), *Спроба* (attempt), *Курс* (course), *Розділ* (section), *Чернетка* (draft), *Оцінка* (grade). The user reviews the wording and can have any phrase changed.

### Error handling

- Missing key in `uk.js`: prevented by a test (below). As a runtime safety net `strings.js` merges `uk` over `en` (deep for the nested `errors`, `states`, `readonly`, `types`, `quizStates` groups), so a missing key shows English instead of `undefined`.
- Storage unavailable: language falls back to auto/phone; the switch still works for the session until reload.

### Testing

- `i18n.test.js`: `resolveLanguage` for explicit choice, `uk-UA`, `ru`, `en-GB`, empty and invalid input; `readPreference`/`savePreference` including throwing storage.
- `lang.test.js`: `uk` and `en` have identical key trees (including nested groups); every `{placeholder}` in `en` appears in the matching `uk` string; no `uk` value is empty; `uk` values differ from `en` for non-proper-noun keys (the allow-list is `appName`, `diagnostics`-like technical words kept the same on purpose).
- `langswitch.test.js` (jsdom): shows the saved choice, saving then calls reload (injected), invalid values are ignored.
- Existing `config.test.js` keeps passing (error codes still all defined in both languages).
- A UI test renders the login screen with `uk` strings to prove the swap works end to end.
- The shell test and `shell.lock.json` enforce the version bump; the new files are added to the service worker `SHELL`.

### Release

Bump `VERSION` in `sw.js`, add `src/i18n.js`, `src/lang/en.js`, `src/lang/uk.js`, `src/ui/langswitch.js` to `SHELL`, re-lock with `npm run lock-shell`, update the README and the roadmap memory, and push only after the user's explicit OK.

### Open details for implementation (not blocking)

- The exact placement/styling of the switch in the header on a narrow phone screen; checked in the preview at phone width.
- The preview page (`tools/preview.html`) gets the switch automatically because it uses the same login and header code.
