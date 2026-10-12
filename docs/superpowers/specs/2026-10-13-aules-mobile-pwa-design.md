# Aules Mobile PWA — Design

Date: 2026-10-13

## Goal
A mobile-friendly web app, opened in Safari and installable to the Home Screen on iPhone and iPad, that signs in to https://aules.edu.gva.es/fpa with the user's own account and shows their courses and course content in a clean, adaptive layout. All data is fetched directly from the device over mobile internet; there is no backend or proxy.

## Scope (v1)
In: login, course list, course content viewer (sections; files, links, pages, folders, labels), logout, offline app shell, cached course list.
Out (later): assignments/calendar, grades, messages/notifications, forums, quizzes, file uploads.

## Feasibility finding
A read-only probe (no login) showed `login/token.php` and `webservice/rest/server.php` respond with `Access-Control-Allow-Origin: *` (including OPTIONS). A static page can therefore call them cross-origin from Safari. Unknown until a real login: whether the account's mobile web-service token is enabled. Fallback (HTML scraping) is out of scope for v1 and only revisited if token issuance fails.

## Architecture
Static PWA, vanilla ES modules, no build step. Served over HTTPS from static hosting (GitHub Pages target; nothing is published without the user's explicit approval). The host only serves files; all data traffic is phone -> aules.

```
index.html, manifest.webmanifest, sw.js, icons/
src/
  api.js      token request + REST calls (core_webservice_get_site_info,
              core_enrol_get_users_courses, core_course_get_contents)
  auth.js     token/userid/siteurl storage (localStorage), login, logout
  store.js    cached courses/contents (localStorage/IndexedDB), offline fallback
  sanitize.js allow-list HTML sanitizer for Moodle-rendered content
  ui/         login, courses, course views; router (hash-based)
  styles.css  mobile-first, safe-area insets, iPad 2-column, light/dark
tests/        unit tests with mocked Moodle responses
```

Each module has one purpose and a narrow interface: `api` knows Moodle's protocol, `auth` owns credentials/token, `store` owns caching, `ui` only renders data it is given.

## Data flow
1. Login: POST `login/token.php` (`username`, `password`, `service=moodle_mobile_app`) -> token. Then `core_webservice_get_site_info` -> userid, fullname. Store token + userid. On first successful login the credentials are also saved in an on-device encrypted vault (see Security) so the session can be renewed silently. The password is never logged or placed in a URL.
2. Courses: `core_enrol_get_users_courses(userid)` -> cards (image, name, progress if present), client-side search.
3. Course: `core_course_get_contents(courseid)` -> collapsible sections and modules. Files/images use `fileurl` with `?token=` appended; page/label HTML is sanitized before render; external links open in a new tab.
4. Successful responses are cached; offline or failed fetch shows cached data with a banner.

## Error handling
- Wrong credentials: inline message on login.
- Expired/invalid token (`invalidtoken`): silently request a new token with the saved credentials and retry the call once; the user sees nothing. If there are no saved credentials, or the saved password is rejected (`invalidlogin`, e.g. password changed), clear everything and return to login. If the silent renewal fails only because of the network, keep the credentials and fall back to cached data.
- Mobile service disabled / no token issued: clear message explaining the account can't use the mobile API.
- Network failure: cached data + "offline" banner.
- Unexpected Moodle exception: generic message with the Moodle `errorcode`.

## Security
- Credentials are typed once at login; none in source, repo, or logs. The sample user/password are NOT embedded anywhere.
- Credential vault (user decision, 2026-10-13): after a successful login the username+password are encrypted with AES-GCM using a non-extractable Web Crypto key kept in IndexedDB; only the ciphertext is in localStorage. This stops casual reading of storage (backups, devtools dumps) but does not protect against code running inside the app origin, which is why the CSP and sanitizer are strict. If IndexedDB/Web Crypto is unavailable (e.g. Safari private mode) nothing is saved and the user simply signs in again after expiry. The login screen tells the user their credentials are kept on this device.
- The session token is also persisted. Token is appended to file URLs, so referrer policy is `no-referrer` and file links are not shared externally.
- All Moodle HTML passes an allow-list sanitizer (no scripts, event handlers, or `javascript:` URLs). Strict CSP in `index.html` (`connect-src` limited to the aules origin).
- Logout deletes token, saved credentials (ciphertext and key) and cached data.

## UX
Mobile-first, safe-area aware (notch, home indicator), standalone display mode, large touch targets, iPad uses a two-column master/detail layout, supports light/dark. Service worker caches the app shell for offline launch.

## Testing
- Unit tests (Node test runner or equivalent, no framework dependency beyond dev tooling) for `api` (request building, error mapping), `auth`, `store`, and `sanitize` against mocked Moodle JSON.
- Visual check at iPhone and iPad viewport sizes.
- First real login is performed by the user on their device (credentials are not entered by the assistant into the live site).

## Open items
- Hosting target confirmed at publish time (default GitHub Pages).
- Real-account validation of token availability and content module coverage.
