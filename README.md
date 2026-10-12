# Aules Mobile

A phone-friendly web app (PWA) for https://aules.edu.gva.es/fpa. It signs in with your Aules account and shows your courses and course content in a clean mobile layout. Built for Safari on iPhone and iPad.

## How it works

- Static files only (vanilla JS modules, no build step, no backend).
- Sign-in uses Moodle's mobile web service: `POST login/token.php` returns a token, then `webservice/rest/server.php` calls (`core_enrol_get_users_courses`, `core_course_get_contents`) read your data. Aules allows these cross-origin requests, so the phone talks to Aules directly over mobile data.
- Course files open with your token appended, only for `aules.edu.gva.es` URLs.

## Run locally

```bash
npm install
npm test
npm run serve
```

Then open:

- `http://localhost:8080/` — the real app (you type your own credentials).
- `http://localhost:8080/tools/preview.html` — demo with fixture data, no network, already "signed in".

## Deploy (your decision, not automatic)

Copy `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` and `src/` to any HTTPS static host (for example GitHub Pages). All paths are relative, so a sub-path works. Bump `VERSION` in `sw.js` whenever you ship changes so phones refresh the cached app shell.

## Install on iPhone / iPad

Open the HTTPS address in Safari, tap Share, then **Add to Home Screen**.

## First-login checklist (do this on the device)

1. Sign in with your user number and password.
2. If you see "Aules did not issue an access token" or "The mobile service is not enabled", your account cannot use Moodle's mobile API. A scraping fallback would be needed (not part of v1).
3. After the first login the app renews an expired session by itself.

## Security notes

- Your login is saved encrypted on the device (AES-GCM, a non-extractable key in IndexedDB, ciphertext in localStorage) so expired sessions renew silently. This protects against casual reading of storage, not against someone using your unlocked phone with the app open. Set an iOS passcode.
- **Sign out** deletes the saved login, the token and the cached data.
- If your Aules password changes, the app asks you to sign in again and wipes the old saved login.
- Anything Moodle sends as HTML passes an allow-list sanitizer; a strict Content-Security-Policy limits network access to `aules.edu.gva.es`.
- If Safari blocks storage (private mode), nothing is saved and you sign in each time.
