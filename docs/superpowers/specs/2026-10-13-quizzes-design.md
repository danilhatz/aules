# Sub-project 3: Quizzes — Design

Date: 2026-10-13. Extends the earlier specs in this folder (all still binding unless changed here); the **write-safety rules of `2026-10-13-assignments-design.md` apply to every quiz write**, and the **performance rules** (saved data first, parallel requests, locked until verified, versioned cache-first shell with `shell.lock.json`) apply to every new screen.

## Evidence
Diagnostics (user's account, Moodle 5.2.1+) shows the token may call: `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_quiz_access_information`, `mod_quiz_get_attempt_access_information`, `mod_quiz_get_quiz_required_qtypes`, `mod_quiz_get_user_attempts`, `mod_quiz_get_user_best_grade`, `mod_quiz_start_attempt`, `mod_quiz_get_attempt_data`, `mod_quiz_save_attempt`, `mod_quiz_process_attempt`, `mod_quiz_get_attempt_summary`, `mod_quiz_get_attempt_review`. The user's only enrolled course has no quiz yet, so real markup has not been seen; v1 is built against faithful sample markup and verified by the user's first real attempt.

## Goals (user-approved scope)
Take **simple** quizzes in the app and review them. Supported question types: `multichoice`, `truefalse`, `shortanswer`, `numerical` (plus `description`, which has no input). Everything else is "Open in Aules". **The app never offers Start for a quiz it cannot finish.**

## Non-goals
Quiz passwords, IP/secure-window/SEB rules, other question types (match, ddwtos, essay, STACK, calculated…), question flagging, offline attempts, automatic submit when time runs out, teacher/preview features, quiz navigation block beyond Previous/Next.

## Start eligibility (all must hold, from FRESH data)
1. `get_quiz_access_information`: `canattempt` is true, and every name in `activerulenames` is in the allowed set `{quizaccess_openclosedate, quizaccess_numattempts, quizaccess_timelimit, quizaccess_delaybetweenattempts}`; any other rule (password, ipaddress, securewindow, seb, …) -> unsupported.
2. `get_quiz_required_qtypes`: every type is in the supported set; otherwise unsupported and the types are listed.
3. `get_attempt_access_information(quizid, 0)`: `preventnewattemptreasons` is empty (otherwise the reasons are shown and Start is hidden); `ispreflightcheckrequired` false.
4. No attempt is currently `inprogress`/`overdue` (otherwise **Continue** is offered instead of Start).
If unsupported: no Start button; "This quiz needs the Aules website" with an **Open in Aules** link (`https://aules.edu.gva.es/fpa/mod/quiz/view.php?id=<cmid>`; the user signs in on the website as usual).
Start is only enabled after all checks returned fresh; a saved copy of the quiz screen shows information read-only.

## Screens and flow
- **Course page:** `quiz` modules become links (`#/course/<c>/quiz/<cmid>`) with the closing time when known (from `get_quizzes_by_courses`: `timeclose`).
- **Quiz screen** `#/course/<c>/quiz/<cmid>`: name, instructions (sanitized), open/close dates, time limit, attempts allowed/used, grading method, best grade; attempts list (number, state, started, grade) with **Continue** (in progress), **Review** (finished and review allowed); the start section above. Starting shows a confirm panel stating "uses one attempt" and any time limit (`timelimit` seconds), then calls `mod_quiz_start_attempt(quizid)`; on success it opens the attempt.
- **Attempt screen** `#/course/<c>/quiz/<cmid>/attempt/<attemptId>`: `get_attempt_data(attemptId, page)` per page; sticky bottom bar **Previous / Save / Next / Finish**. `navmethod === 'sequential'` hides Previous. Page change = `process_attempt(attemptId, data, finishattempt=0)` (what Moodle's own paging does); **Save** = `save_attempt`. If the attempt data contains a question type outside the supported set (should not happen after the start check; possible for an attempt begun on the website) the whole attempt is shown as "continue on the Aules website" and no controls are rendered.
- **Timer:** countdown from `get_attempt_access_information(quizid, attemptId).endtime`; display only. At zero the controls lock and a prominent **Submit** button appears; nothing is sent automatically. Clock skew is acknowledged in the UI text ("approximate").
- **Finish:** `get_attempt_summary` -> "N of M answered"; a confirm panel; then `process_attempt(attemptId, data, finishattempt=1)`. Afterwards the quiz screen is reloaded (attempts list with grade, or "grade not yet available").
- **Review** `#/course/<c>/quiz/<cmid>/review/<attemptId>`: `get_attempt_review(attemptId, page=-1)`: grade, answers with Aules' feedback and correct answers, read-only. If Aules refuses (review options), its message is shown.

## Question markup handling
`mod_quiz_get_attempt_data` returns each question as ready-made HTML (`questions[].html`). A dedicated `sanitizeQuestionHtml` (separate from `sanitizeHtml`, which is unchanged) keeps layout elements (`div span p br b strong i em sub sup ul ol li table… label fieldset legend img a`) and answer controls **only if safe**:
- `input` of type `radio|checkbox|text|hidden`, `select`, `option`, `textarea`; attributes limited to `type name value id checked disabled readonly size maxlength inputmode for selected`.
- `name` must match `^q\d+:\d+_:?[A-Za-z0-9_-]+$` (Aules' own pattern); `id`/`for` must match `^q\d+:\d+_[A-Za-z0-9:_-]+$`; anything else is dropped (no DOM clobbering, no foreign fields).
- Flag controls (names ending `:flagged`) and Aules' `questionflag` blocks are removed; flag fields are never sent.
- `class` is filtered to an allow-list of Moodle's presentational classes (`que correct incorrect partiallycorrect state grade qtext answer rightanswer specificfeedback generalfeedback outcome feedback prompt ablock formulation content info no qno`); no `style`, no event handlers, no scripts, no forms.
- File URLs get the token via `withToken`; `javascript:`/`data:` URLs are dropped. In review (non-interactive) mode all controls are forced `disabled`.
- Maths shown by Aules' client-side filter appears as plain `\( … \)` text (known limitation).
`collectAnswers(container)` serialises exactly like a browser form: hidden fields always; radio/checkbox only when checked; text/select/textarea values; names validated again; flag fields excluded. Sent as `data[i][name]` / `data[i][value]`. `applyAnswers(container, answers)` restores locally kept answers.

## Local answer protection
Answers typed on the current page are kept in `localStorage` under `aules.attempt.<attemptId>` (index-based so sign-out clears them all, same pattern as drafts) and reapplied when the page re-renders; removed after a successful save/finish and on sign-out. Server state wins for pages never touched locally.

## Write-safety (binding, same as assignments, plus)
- Start, Save, page change and Finish each need a tap; **Start** and **Finish** go through an in-page confirm.
- Single-flight; no automatic retry or replay; `invalidtoken` renews the session but never replays a write (asks to tap again).
- Unknown outcome (network/`badresponse` after the request was sent): Start -> reload attempts (an in-progress attempt now appears as **Continue**); Save/page/Finish -> reload the attempt/summary and say "could not confirm". Never assume success or failure.
- Every write step is refused after sign-out and its result dropped; flash messages are bound to the attempt that produced them.
- The answer area locks while a write is in flight.
- Moodle `warnings` and error codes are shown with Moodle's message.

## Architecture
```
src/api.js         + getQuizzes, getQuizAccess, getAttemptAccess, getQuizQtypes, getUserAttempts, getBestGrade,
                     startAttempt, getAttemptData, saveAttempt, processAttempt, getAttemptSummary, getAttemptReview
src/quiz.js        NEW pure: parseQuiz, parseAttempts, parseBestGrade, startCheck(...), SUPPORTED_QTYPES, formatTimeLeft
src/qhtml.js       NEW sanitizeQuestionHtml, collectAnswers, applyAnswers, isValidFieldName
src/attemptstore.js NEW createAttemptStore(storage)
src/ui/quiz.js     NEW quiz screen
src/ui/attempt.js  NEW attempt + review screens
src/content.js     'quiz' modules become kind 'quiz' (links; no longer coming soon)
src/ui/course.js   quiz links with closing time
src/app.js         3 routes, loaders (saved-first, parallel, locked-until-fresh), write helpers with epoch guards
src/strings.js, src/styles.css, sw.js (SHELL + VERSION bump, npm run lock-shell)
```

## Error handling
Friendly messages for Moodle codes; unsupported situations are explained, never silent. Offline: saved quiz info is shown read-only, no attempt actions.

## Testing
Unit: `startCheck` for every blocking reason (rules, qtypes, reasons, in-progress, preflight); parsing of odd/missing Moodle shapes; `sanitizeQuestionHtml` with hostile markup (foreign field names, `onclick`, `style`, `javascript:` links, fake hidden fields, `<form action>`, flag controls) and faithful multichoice/truefalse/shortanswer/numerical samples; `collectAnswers` equals browser serialisation (radio/checkbox/hidden/select/text, unchecked skipped, flags excluded); `applyAnswers`; attempt store (+clear on sign-out); API request shapes (`data[i][name]`, `finishattempt`); UI states (cannot start, can start, in progress, finished with review, timer lock, confirm-before-start/finish, single-flight, unconfirmed outcome); app wiring (saved-first, parallel, epoch/sign-out, no replay). Manual: the user takes a throw-away quiz on the phone; the assistant never logs in or runs write calls against the live site.

## Open items (verify on the device, by the user)
- Real markup of the four supported types on Aules (the field-name patterns above).
- Values of `get_attempt_summary` states used to count unanswered questions (treated defensively).
- Whether `process_attempt` for paging needs the page's `slots`/`thispage` (Moodle's WS ignores them; design assumes not).
- Behaviour of Aules for `navmethod: sequential` quizzes and for review permissions.
