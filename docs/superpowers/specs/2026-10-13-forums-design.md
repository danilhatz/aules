# Sub-project 5: Forums (read + reply) — Design

Date: 2026-10-13. Extends the earlier specs in this folder (all still binding unless changed here). The **write-safety rules of `2026-10-13-assignments-design.md` apply to every forum write**, the **performance rules** (saved data first, parallel requests, writes locked until fresh data is verified, versioned cache-first shell with `shell.lock.json`) apply to every new screen, and **every new user-visible string goes into both `src/lang/en.js` and `src/lang/uk.js`** (the parity test enforces it).

## Evidence
The user's Diagnostics report shows the token may call `mod_forum_get_forum_discussions`, `mod_forum_add_discussion` and `mod_forum_add_discussion_post` (all "yes"); the same Moodle (5.2.1+) exposes `mod_forum_get_forums_by_courses` and `mod_forum_get_discussion_posts` (core since 3.7), but those two have **not** been confirmed on this site yet. Real forum data has not been seen, so v1 is built against faithful sample data and verified on the device. Diagnostics gets the two extra function names so the next report confirms them.

## Goals (user-approved scope)
Open a forum from a course, see its topics, read a topic's posts, and **reply** to a post. Plain-text replies only. Each reply needs a confirmation.

## Non-goals
Starting new topics, editing or deleting posts, attachments on replies, subscriptions, read/unread tracking (and therefore no `mod_forum_view_*` calls), ratings, private replies, pinning, search, group switching, offline posting, teacher features, notifications.

## Screens and flow
- **Course page:** `forum` modules stop saying "Coming soon" and become links (`#/course/<c>/forum/<cmid>`). `src/content.js` stops marking `forum` as `SOON` and gives it `kind: 'forum'`; `SOON` becomes empty.
- **Forum screen** `#/course/<c>/forum/<cmid>`: the forum name and intro (sanitised), then topics newest-activity first (`mod_forum_get_forum_discussions`, `sortorder` default, pages of 20 via `page`/`perpage`). A topic row shows title, author, last-modified time, reply count, and a pinned or locked marker. A **Load more** button appears while the last page came back full; its result is appended. The forum itself comes from `mod_forum_get_forums_by_courses` (matched by `cmid`).
- **Topic screen** `#/course/<c>/forum/<cmid>/topic/<discussionId>`: all posts from `mod_forum_get_discussion_posts` (`sortby=created`, `sortdirection=ASC`), threaded by `parentid`. Indentation stops at depth 3 on a phone (deeper replies stay at depth 3 and show "in reply to <author>"). A post shows author, time, subject (when it differs from the topic title and is not just "Re: …"), the sanitised message, and attached files as links with the token. Deleted posts (`isdeleted`) show a short "removed" note.
- **Reply:** a **Reply** button appears on a post only when Aules says the user may reply (`capabilities.reply`; the topic-level `canreply` from the list is also respected). It opens a text box under that post. The text is kept as a local draft while typing (`aules.draft.forum.<postId>`, cleared at sign-out and after a successful send). **Send** opens the in-page confirm "Send your reply now?" with **Yes, send** and **Cancel**. The subject is `Re: <parent subject>` (an existing leading `Re:` is not repeated). The text is sent as HTML: each line escaped and wrapped in `<p>`, so typed `<` and `&` appear literally. After success the topic reloads and the new post is scrolled into view with the flash "Reply sent." Empty or whitespace-only text cannot be sent.
- **News/announcement forums** (`type: news`) and any post without `reply` capability show no Reply button; no special handling beyond that. Aules decides what is visible in Q&A forums; the app shows what Aules returns.

## Data handling
- **Message HTML** goes through the existing `sanitizeHtml` with `rewriteUrl: withToken` (same as course content). `pluginfile` URLs in messages use `toWebserviceUrl` so the token works. Attachment links use `withToken`.
- **Author names, avatars:** names only; no avatar images (avoids extra requests on mobile data).
- **Times** use `formatDue`-style `Intl` formatting with the app `LOCALE`.
- **Caching:** `forums:<courseId>`, `topics:<forumId>:<page>` and `posts:<discussionId>` in `createCache` (cleared at sign-out). Saved copy renders first; the fresh copy replaces it only if different. The Reply buttons stay hidden until fresh posts are verified; offline shows the saved posts read-only with the "Editing is available when you are back online" note.
- **Requests run in parallel** with `settle()` where independent (forum record and first page of topics).

## Write-safety (binding, same as assignments, plus)
- Reply needs a tap on **Send**, then a tap on **Yes, send**.
- Single-flight: the box, Send and Reply buttons lock while a request is in flight.
- No automatic retry or replay: `invalidtoken` during the write renews the session and throws `retry` ("Your session was renewed. Tap again."); the reply text stays in the box.
- Unknown outcome (`network` or `badresponse` after the request was sent): map to `unconfirmed`, reload the topic and say "Could not confirm — the screen was refreshed so you can check the status." The draft is kept so the user can resend deliberately.
- Every write step is refused after sign-out (`auth.epoch()` guard) and results and flash messages are dropped.
- Moodle `warnings` in the write result are shown as the error (nothing is assumed saved).
- The draft is removed only after a confirmed success.

## Architecture
| File | Role |
|---|---|
| `src/api.js` | `getForums(token, courseId)`, `getForumDiscussions(token, forumId, {page, perpage})`, `getDiscussionPosts(token, discussionId)` (reads); `addDiscussionPost(token, postId, subject, message)` (write; warnings become errors like other writes). |
| `src/forum.js` | Pure parsing and logic: `parseForums`, `parseDiscussions`, `parsePosts` (strict shape checks, unknown shapes -> `badresponse`), `buildThread(posts)` (tree with depth clamp), `replySubject(parentSubject)`, `replyHtml(text)`, `canReply(post, discussion)`. |
| `src/ui/forum.js` | `renderForum` (topic list) and `renderTopic` (posts + reply box + confirm). |
| `src/app.js` | Routes `forum` and `topic`, loaders with saved-first caching, `guardedWrite` / `sentOnce` reuse for the reply, draft handling via `drafts`. |
| `src/content.js`, `src/ui/course.js` | `forum` kind and link. |
| `src/diagnostics.js` | CHECKS gains `mod_forum_get_forums_by_courses`, `mod_forum_get_discussion_posts`. |
| `src/lang/en.js`, `src/lang/uk.js` | New strings (topics, replies, load more, reply sent, removed post, etc.). |
| `sw.js`, `shell.lock.json` | New files in `SHELL`, `VERSION` bump, re-lock. |

Router additions: `#/course/<c>/forum/<cmid>` and `#/course/<c>/forum/<cmid>/topic/<id>`; ids must be positive integers or the route falls back to the course.

## Error handling
Read failures show the usual error text with **Retry**, keeping any saved copy. A forum that is not found in the course shows "This forum was not found in the course." Moodle's own messages (for example a closed forum, a posting deadline passed) are shown as Moodle sent them.

## Testing
- `forum.test.js`: parsers (good shapes, missing fields, wrong types), `buildThread` (ordering, orphans whose parent is missing, depth clamp, cycles), `replySubject`, `replyHtml` (escaping, blank lines, `<script>` typed by the user stays literal), `canReply`.
- `api.test.js` additions: exact request parameters for each call; `addDiscussionPost` warnings become errors.
- `forum-ui.test.js` (jsdom): topic list, Load more, thread rendering, deleted post note, Reply hidden without capability, confirm flow, locked-while-busy, draft kept on failure, draft removed on success.
- `app.test.js` additions: routes; saved-first rendering; sign-out during a reply drops the result; `unconfirmed` path reloads and keeps the draft; `retry` after an expired token; the reply is sent exactly once (no replay).
- Existing parity test keeps English and Ukrainian identical.

## Open items (verify on the device, by the user)
1. That `mod_forum_get_forums_by_courses` and `mod_forum_get_discussion_posts` exist on Aules (Diagnostics will show it).
2. How Aules renders a plain-text reply sent as simple `<p>` HTML (a test reply in a practice forum).
3. Real post data shapes (`capabilities.reply`, `isdeleted`, attachments). Any mismatch is fixed from a pasted Diagnostics report.
