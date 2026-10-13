# Sub-project 1: Category folders, course page restyle, diagnostics — Design

Date: 2026-10-13. Extends `2026-10-13-aules-mobile-pwa-design.md` (still binding for everything not changed here).

## Context
The app (live at https://danilhatz.github.io/aules/) lists enrolled courses flat and shows course content. The user wants: courses grouped in Aules category folders, a layout suited to Spanish language-learning courses, and — across later sub-projects — assignments (text + file), quizzes and forums with the ability to send data to Aules. This sub-project is read-only groundwork; sub-projects 2 (assignments), 3 (quizzes), 4 (forums) get their own specs after this one, informed by the diagnostics output.

## Goals
1. Courses screen shows category folders; tapping a course opens it as the selected course.
2. Course page restyled for language learning (unit cards, type labels, bigger targets), still read-only.
3. A diagnostics screen the user runs on their own device to reveal what their Aules account/token can do, replacing the assistant ever logging in with the user's credentials.

## Non-goals
No writes to Aules, no assignments/quizzes/forums, no tab bar (added when the To-do tab has content), no in-app file viewer.

## Category folders
Source order (first that works wins, per session; failure falls through, never errors the screen):
1. `core_course_get_enrolled_courses_by_timeline_classification` (`classification: "all"`, `limit: 0`) -> each course has `coursecategory` (name), `progress`, `courseimageurl`/`overviewfiles`.
2. `core_enrol_get_users_courses` (existing) for `category` id + `core_course_get_categories` (`criteria[0][key]=ids`) for names/paths.
3. No category info -> flat list, exactly today's behaviour.

`groupCourses(courses) -> [{name, courses[]}]`: stable alphabetical folders, courses alphabetical inside; courses without a category go to a folder named by `STRINGS.uncategorised`; if only one folder results, render the flat list without a folder header. Category path names containing `/` or `>` display as the full name in one folder (no nesting in v1).

UI: collapsible folder (`<details>`) with name + course count; open/closed state persisted in `localStorage` key `aules.folders` (best-effort). Search filters courses across all folders and force-opens folders with matches; folders with no match are hidden. Tapping a course card navigates to `#/course/<id>` (existing route) and highlights it (`aria-current`) — on iPad the course shows in the right pane.

Course data caching: the grouped result is cached like `courses` today; cache key unchanged.

## Course page restyle
- Each non-empty section is a numbered unit card; when `core_completion_get_activities_completion_status` is not used (v1), show only the course-level progress bar from the overview data.
- Each module shows a type label from `kind` (Reading=page, File, Folder, Link, Label has none, other types by `modname`: Exercise=assign, Quiz=quiz, Forum=forum, other=Activity). Exercise/Quiz/Forum modules are shown with a visible "coming soon" note (replaces today's "Not available" text) and are not links.
- Touch targets >= 44px, body text 17px, generous spacing; two-column layout on iPad unchanged. Light/dark unchanged.
- `ViewModule` gains `modname` (raw) so labels can be derived; `kind` values unchanged for existing behaviour.

## Diagnostics
Menu (header, next to Sign out) -> "Diagnostics" opens `#/diagnostics`. On open it runs read-only calls and renders a plain-text report in a `<pre>` with a **Copy** button (Clipboard API with a select-all fallback):
- `core_webservice_get_site_info`: report `release`, `version`, `sitename` omitted, and the **names** of `functions` (this reveals which write functions e.g. `mod_assign_save_submission`, `mod_quiz_start_attempt`, `mod_forum_add_discussion_post` the token may call), plus `usercanmanageownfiles`, `userquota`, `usermaxuploadfilesize`.
- Category source used (1, 2 or 3) and the category tree (names + course counts, no course names).
- Per enrolled course: count only, then aggregated module `modname` counts across the first N=5 courses' contents.
- Redacted structure sample: for one course's contents and one overview course object, keys and value types only; every string replaced by `"<string>"`, numbers by `"<number>"`; arrays truncated to 2 elements.
- Never includes: token, password, user id, user/full names, course names, file names, URLs.
Failures of individual calls are reported inline as `<call>: <errorcode>` and do not abort the report.

## Architecture changes
```
src/api.js          + getCoursesByTimeline(token), getCategories(token, ids), getSiteInfoRaw (existing getSiteInfo reused)
src/courses.js      NEW  loadCourseList({api,call...}) source fallback + groupCourses(); pure parts unit-tested
src/diagnostics.js  NEW  buildReport(data) pure redaction/formatting; runDiagnostics(api, token) collects data
src/ui/courses.js   folders UI; search across folders
src/ui/course.js    unit cards, type labels
src/ui/diagnostics.js NEW  report view + Copy
src/app.js          route #/diagnostics, header menu, use courses.js loader
src/strings.js      new strings (uncategorised, type labels, comingSoon, diagnostics*)
```
`app.js` keeps its `call()` (silent relogin) wrapper around every new API call.

## Error handling
- Any category source failing falls to the next; never shows an error for categories.
- Diagnostics call failures reported inline; `invalidtoken` still goes through silent renewal.
- Clipboard unavailable -> text pre-selected with a "select and copy" hint.

## Security
Read-only. Diagnostics redaction is unit-tested with hostile fixtures (tokens, names, URLs in values). Report built from an allow-list of fields, not by deleting known-bad ones.

## Testing
Unit: `groupCourses` (categories, uncategorised, single folder, ordering, path names), source fallback order with mocked API failures, redaction/allow-list of `buildReport`, folder persistence, search-forces-open, course page type labels and coming-soon notes. Manual: phone/iPad layout via preview harness (extend fixtures with categories); user runs Diagnostics on their device and pastes the report.

## Open items
- Real `core_*` availability and category data only known after the user's diagnostics run; the fallback chain keeps the app working either way.
