# Sub-project 2: Assignments (Exercises) — Design

Date: 2026-10-13. Extends `2026-10-13-aules-mobile-pwa-design.md` and `2026-10-13-categories-diagnostics-design.md` (both still binding unless changed here). This is the first sub-project that **writes** to Aules, so the write-safety rules below are binding.

## Evidence (user's Diagnostics report, 2026-10-13)
Moodle 5.2.1+ (Build 20260630). The token may call `mod_assign_get_assignments`, `mod_assign_get_submission_status`, `mod_assign_save_submission`, `mod_assign_submit_for_grading`, `core_files_get_unused_draft_itemid`, `core_files_delete_draft_files`. **Not** allowed: `core_files_upload`; `usercanmanageownfiles` is false. File upload normally uses `webservice/upload.php` (not a WS function; CORS `*` confirmed) and may be refused for this account — so file upload is built but gated on a user-run **Test upload**. The user's course has 2 `assign` modules. GVA also ships `mod_assigngva_*`; no `assigngva` module was seen, so it is out of scope.

## Goals
1. Tapping an Exercise (`modname: assign`) on the course page opens an assignment screen.
2. Show instructions, attachments, dates, status, grade and teacher feedback.
3. Let the student write a typed answer and save a draft / submit it.
4. If (and only if) upload works for the account, let the student attach photos/files.
5. Diagnostics gains a user-run **Test upload** whose outcome appears in the report.

## Non-goals
Quizzes, forums, teacher/grader features, team (group) submissions, `assigngva`, rich-text editing, offline write queue, push notifications, To-do tab.

## Write-safety rules (binding)
- Nothing is written without an explicit tap. **Save draft** and **Submit** are separate buttons; **Submit** shows a confirmation dialog first and, when `requiresubmissionstatement`, a required checkbox with the sanitized statement (`acceptsubmissionstatement=1`).
- Single-flight: buttons are disabled while a request is in flight; no automatic retries of any write; no offline queue (offline -> clear error, nothing sent).
- Unknown outcome (network failure after a write was sent): show "Could not confirm — open the assignment again to check", re-fetch the status, never assume success or failure.
- Plugin data is sent only for plugins the student actually changed (text changed -> `onlinetext_editor`; files changed -> `files_filemanager`), so editing text can never wipe files. **Correction (final review, verified against Moodle source):** Moodle runs `save()` on *every* enabled submission plugin and the online-text plugin cannot tolerate a missing editor (it fails the save, or on a lenient database overwrites the answer with NULL). So when online text is enabled and only files changed, the **unchanged typed answer is re-sent alongside** (`{text, format: 1, itemid: 0}`; an empty answer is sent as `''`). If the existing answer has website formatting it cannot be re-sent faithfully, so changing files is refused until the student chooses "Replace with plain text". The files plugin is safe to omit (it checks for emptiness).
- A saved local draft stores the server text it was typed against; it is restored automatically only when that text is unchanged and plain, otherwise it is offered (Restore / Discard) and never applied silently. Camera photos with the same name get unique names (`image (2).jpg`). `upload.php` per-file errors (duplicate, too big) are surfaced with Moodle's message. A lost or garbled reply after a save/submit was sent is an *unconfirmed* outcome (refresh), while errors before anything was sent are plain errors. Every write step is refused after sign-out and its result dropped. File upload is shown only after a successful Test upload. If the existing submission already holds files and the student changes the file set, retained files are re-sent in the same draft area; if re-adding a retained file fails, the whole save is aborted (never silently dropping files).
- Locked / past cut-off / `canedit` false / team submission / `nosubmissions`: the form is not shown, with an explanatory note.
- Moodle-supplied HTML (instructions, feedback, statement) always goes through `sanitizeHtml`.
- Test upload writes one 1-byte file to the user's own *draft* area only, then asks Moodle to delete it; it never touches any assignment.

## Moodle API usage
- `mod_assign_get_assignments(courseids[0]=<id>)` -> `courses[0].assignments[]`: `id`, `cmid`, `name`, `intro`, `introattachments[]`, `duedate`, `allowsubmissionsfromdate`, `cutoffdate`, `nosubmissions`, `submissiondrafts`, `requiresubmissionstatement`, `submissionstatement`, `teamsubmission`, `maxattempts`, `configs[]` (`plugin`/`subtype`/`name`/`value`; `onlinetext` and `file` are enabled when `{subtype: 'assignsubmission', name: 'enabled', value: '1'}`).
- `mod_assign_get_submission_status(assignid)` -> `lastattempt.submission.{status('new'|'draft'|'submitted'|'reopened'), plugins[]}`, `lastattempt.{canedit, cansubmit, locked, graded, extensionduedate}`, `feedback.{gradefordisplay, plugins[]}`; online text is the `onlinetext` plugin's `editorfields[0].text`, files are the `file` plugin's `fileareas[0].files[]`.
- `core_files_get_unused_draft_itemid()` -> `itemid` (draft area for the editor; fall back to `0` if refused).
- `mod_assign_save_submission(assignmentid, plugindata[onlinetext_editor][text], plugindata[onlinetext_editor][format]=1, plugindata[onlinetext_editor][itemid], plugindata[files_filemanager]=<draft itemid>)` -> warnings[] (non-empty = failure).
- `mod_assign_submit_for_grading(assignmentid, acceptsubmissionstatement)` -> warnings[]. When `submissiondrafts` is 0, saving already submits and only a **Submit** button is shown.
- `webservice/upload.php` (multipart POST: `token`, `filearea=draft`, `itemid` (0 for the first file, then the returned id), `filepath=/`, `file_1`) -> `[{itemid, filename, ...}]` or `{error, errorcode}`.
- `core_files_delete_draft_files` for Test-upload cleanup (best effort).

## UI
Route `#/course/<courseId>/assign/<cmid>` (detail pane; phone: own screen with back to the course).
- Course page: `assign` modules become links (Exercise chip + name + due date + "Opens" affordance); other `soon` types unchanged.
- Assignment screen: title, due (relative via `Intl.RelativeTimeFormat` + absolute localized date; "overdue" in warning colour), status badge (Not submitted / Draft / Submitted / Graded), instructions + attachments (token via `withToken`), then:
  - **Typed answer** (only when `onlinetext` enabled and editable): plain `<textarea>`; text is sent as HTML (HTML-escaped, blank-line-separated paragraphs as `<p>`, single newlines as `<br>`). Existing text made of only `p`/`br`/text is shown as plain text; if it contains other formatting the field is read-only with a "formatted on the website" note and an explicit "Replace with plain text" button.
  - **Files** (only when `file` plugin enabled, editable, and upload is available): file input (`accept="*/*"`, so iOS offers camera/photos/Files); client-side checks against `usermaxuploadfilesize` and the assignment's own limits (when present in `configs`); list of attached files with remove; existing files listed with token links.
  - Buttons per the write-safety rules; success/error messages are inline and persistent until dismissed.
  - After a grade: grade for display and teacher feedback (sanitized).
- Local draft protection: while typing, the text is stored in `localStorage` key `aules.draft.<assignid>` (debounced); restored when reopening; removed after a successful save/submit and on sign out (all `aules.draft.*` keys).
- Diagnostics: new **Test upload** button under the report; result line `Upload test: ok` / `Upload test: <errorcode>` is appended to the report (and included when copied). Not run automatically.

## Architecture changes
```
src/api.js          + getAssignments, getSubmissionStatus, getUnusedDraftItemId, saveSubmission, submitForGrading,
                      deleteDraftFiles, uploadDraftFile (multipart; no JSON Content-Type)
src/assign.js       NEW pure logic: parseAssignment(raw), parseStatus(raw), enabledPlugins(configs), textToHtml/htmlToText,
                      canEdit(state), buildSaveParams(...), formatDue(ts, now)
src/drafts.js       NEW createDrafts(storage): get/set/remove/clear for local typed-text drafts
src/ui/assign.js    NEW assignment screen (form, confirm dialog, file list, messages)
src/ui/course.js    assign modules link to the assignment route
src/diagnostics.js  + uploadTest result in the report
src/ui/diagnostics.js + Test upload button
src/app.js          route, loaders via call(), logout clears drafts, write helpers with epoch guards
src/strings.js, src/styles.css, sw.js (SHELL + VERSION v3)
```

## Error handling
Moodle warnings (`warnings[0].message`/`warningcode`) and exceptions are mapped to friendly text with the Moodle message appended (`submissionclosed`, `nopermission`, `invalidparameter`, size/quota, `network`). `invalidtoken` still goes through silent renewal for reads; for writes it renews then asks the user to tap again (never auto-replays a write). Sign-out during a request drops the result (epoch guard).

## Testing
Unit: parsing of every status/plugin combination from mocked Moodle JSON; text<->HTML conversion (escaping, hostile text, newlines); `buildSaveParams` sends only changed plugins; locked/closed/team/`nosubmissions`/no-plugin states hide the form; due-date formatting; drafts store incl. clear on logout; API request shapes (`plugindata[...]` keys, multipart without JSON header); single-flight and confirm-before-submit; unknown-outcome path; upload size check; Test upload success/failure/cleanup. Manual: the user runs Test upload and one real draft save on their phone; no real credentials are ever entered by the assistant.

## Open items (verify on the device, by the user)
- Whether `upload.php` accepts this account (Test upload decides; typed-answer path works regardless).
- Whether `save_submission` tolerates omitting `files_filemanager` when only text changed (design assumes yes; the test with a real draft will confirm).
- Whether `core_files_get_unused_draft_itemid` is usable without `manageownfiles` (fallback itemid 0).
