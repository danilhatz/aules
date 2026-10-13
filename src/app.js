import { clear, h } from './ui/dom.js';
import { renderLogin } from './ui/login.js';
import { renderCourseList } from './ui/courses.js';
import { renderCourse, renderBack } from './ui/course.js';
import { renderDiagnostics } from './ui/diagnostics.js';
import { renderAssign } from './ui/assign.js';
import { buildCourse } from './content.js';
import { loadCourseList } from './courses.js';
import { runDiagnostics, buildReport } from './diagnostics.js';
import { parseAssignment, parseStatus, editability, draftBase } from './assign.js';
import { performSubmission } from './submit.js';
import { createFolderState } from './folders.js';
import { createDrafts } from './drafts.js';
import { createMemoryStorage } from './storage.js';
import { describeError } from './errors.js';
import { MoodleError } from './api.js';
import { STRINGS as S } from './strings.js';

const assignmentsOf = (res) => (res && Array.isArray(res.courses) && res.courses[0] && Array.isArray(res.courses[0].assignments) ? res.courses[0].assignments : []);
const safeCode = (c) => (typeof c === 'string' && /^[a-z][a-z_]{1,60}$/.test(c) ? c : 'error');
const duesOf = (list) => Object.fromEntries(list.filter((a) => a && a.cmid != null).map((a) => [a.cmid, Number(a.duedate) || 0]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Attaches handlers immediately so a request we may not await can never become an unhandled rejection.
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
const SITE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;

export function createApp({
  root, api, auth, cache, win = globalThis.window,
  folderState = createFolderState(createMemoryStorage()),
  drafts = createDrafts(createMemoryStorage()),
  timings = null,
  locale = globalThis.navigator && globalThis.navigator.language,
  nowFn = () => Math.floor(Date.now() / 1000),
}) {
  let courses = [];
  let lastList = null; // last loaded { courses, source, raw }; reused by Diagnostics
  let offline = false;
  let shell = null;
  let listPane = null;
  let detailPane = null;
  let pendingFlash = null; // { cmid, kind }: shown once, only on the assignment that was just saved
  let renderId = 0; // newest showRoute wins; older in-flight loads must not paint
  let siteLimitPending = false;
  let renewing = null; // one shared silent renewal, however many requests hit an expired token at once

  const view = () => {
    const hash = win.location.hash;
    if (hash === '#/diagnostics') return { type: 'diagnostics' };
    let m = /^#\/course\/(\d+)\/assign\/(\d+)$/.exec(hash);
    if (m) return { type: 'assign', courseId: Number(m[1]), cmid: Number(m[2]) };
    m = /^#\/course\/(\d+)$/.exec(hash);
    return m ? { type: 'course', id: Number(m[1]) } : { type: 'list' };
  };
  const route = () => {
    const v = view();
    if (v.type === 'course') return v.id;
    return v.type === 'assign' ? v.courseId : null;
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
    drafts.clear();
    courses = [];
    lastList = null;
    siteLimitPending = false;
    renewing = null;
    pendingFlash = null;
    showLogin(message);
    if (win.location.hash) win.location.hash = '';
  }

  function renew() {
    if (!renewing) renewing = auth.relogin().finally(() => { renewing = null; });
    return renewing;
  }

  // Run an authenticated read. On an expired token, silently renew it from the
  // saved credentials and retry exactly once.
  async function call(fn) {
    try {
      return await fn(auth.getSession());
    } catch (err) {
      if (!err || err.code !== 'invalidtoken') throw err;
      let fresh;
      try {
        fresh = await renew();
      } catch (reErr) {
        // Saved password rejected -> treat as a dead session; anything else (network) propagates.
        if (reErr && reErr.code === 'invalidlogin') throw new MoodleError('invalidtoken');
        throw reErr;
      }
      if (!fresh) throw err; // nothing saved
      return fn(fresh);
    }
  }

  // Run an authenticated WRITE exactly once. On an expired token the session is renewed
  // but the write is never replayed: the user is asked to tap again.
  async function callWrite(fn) {
    try {
      return await fn(auth.getSession());
    } catch (err) {
      if (!err || err.code !== 'invalidtoken') throw err;
      let fresh;
      try {
        fresh = await renew();
      } catch (reErr) {
        if (reErr && reErr.code === 'invalidlogin') throw new MoodleError('invalidtoken');
        throw reErr;
      }
      if (!fresh) throw err;
      throw new MoodleError('retry');
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
        h('a', { class: 'link', href: '#/diagnostics' }, S.diagnostics),
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout)),
      ...(offline ? [h('p', { class: 'banner' }, S.offline)] : []),
      renderCourseList({ courses, token, selectedId: route(), folderState }));
  }

  // background = true: the saved list is already on screen, so only update it when something changed.
  async function loadCourses(background = false) {
    const epoch = auth.epoch();
    try {
      const res = await call((s) => loadCourseList({ api, token: s.token, userid: s.userid }));
      if (auth.epoch() !== epoch) return false; // signed out meanwhile: drop the result
      const changed = !same(res.courses, courses) || offline;
      courses = res.courses;
      lastList = res;
      cache.set('courses', courses);
      offline = false;
      if (background && changed) renderList();
    } catch (err) {
      if (auth.epoch() !== epoch) return false;
      if (handleFatal(err)) return false;
      const saved = cache.get('courses');
      if (!saved) {
        clear(listPane).append(
          h('p', { class: 'error' }, describeError(err)),
          h('button', { class: 'btn retry', type: 'button', onclick: () => showShell() }, S.retry));
        return false;
      }
      courses = saved.data;
      lastList = null;
      offline = true;
      if (background) renderList();
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
    const saved = cache.get('courses');
    if (saved) {
      // Show last visit's courses at once and refresh them in the background.
      courses = saved.data;
      lastList = null;
      offline = false;
      renderList();
      await Promise.all([showRoute(), loadCourses(true)]);
      return undefined;
    }
    if (await loadCourses()) await showRoute();
    return undefined;
  }

  // The site-wide upload limit comes from getSiteInfo, a very large response (Aules lists ~460 functions).
  // It is remembered for a day and refreshed quietly, so it never delays a screen.
  function refreshSiteLimit() {
    const saved = cache.get('siteMax');
    if ((saved && Date.now() - saved.savedAt < SITE_LIMIT_TTL_MS) || siteLimitPending) return;
    siteLimitPending = true;
    const epoch = auth.epoch();
    call((s) => api.getSiteInfo(s.token))
      .then((info) => { if (auth.epoch() === epoch) cache.set('siteMax', Number(info && info.usermaxuploadfilesize) || 0); })
      .catch(() => { /* unknown limit: the server enforces its own */ })
      .finally(() => { siteLimitPending = false; });
  }

  function uploadLimit(assignment) {
    if (!assignment.plugins.file) return 0;
    refreshSiteLimit();
    const saved = cache.get('siteMax');
    const limits = [saved ? saved.data : 0, assignment.maxBytes].filter((n) => n > 0);
    return limits.length ? Math.min(...limits) : 0;
  }

  async function uploadTest() {
    const epoch = auth.epoch();
    try {
      const r = await callWrite((s) => api.uploadDraftFile(s.token, { name: 'aules-app-test.txt', blob: new Blob(['x'], { type: 'text/plain' }) }, { itemid: 0 }));
      try {
        await callWrite((s) => api.deleteDraftFiles(s.token, r.itemid, [{ filepath: '/', filename: r.filename || 'aules-app-test.txt' }]));
      } catch { /* cleanup is best effort; Moodle clears stale drafts itself */ }
      if (auth.epoch() === epoch) cache.set('uploadOk', true);
      return 'Upload test: ok';
    } catch (err) {
      const definite = err && !['network', 'retry', 'invalidtoken'].includes(err.code);
      if (definite && auth.epoch() === epoch) cache.set('uploadOk', false);
      return `Upload test: ${safeCode(err && err.code)}`;
    }
  }

  async function send(assignment, input, epoch) {
    // After sign-out no further step of an in-flight save may run (it would use the next session's token).
    const write = (fn) => {
      if (auth.epoch() !== epoch) throw new MoodleError('signedout');
      return callWrite(fn);
    };
    const result = await performSubmission({ api, write, assignment, input });
    if (auth.epoch() !== epoch) throw new MoodleError('signedout');
    drafts.remove(assignment.id);
    return result;
  }

  async function showAssign(courseId, cmid, session, rid) {
    const epoch = auth.epoch();
    const flash = pendingFlash && pendingFlash.cmid === cmid ? pendingFlash.kind : '';
    pendingFlash = null;
    const onThis = () => { const v = view(); return v.type === 'assign' && v.cmid === cmid; };
    const here = () => onThis() && rid === renderId;
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}` }, '‹ ', S.backToCourse);
    const cachedStatus = (id) => {
      const entry = cache.get(`status:${id}`);
      return entry ? parseStatus(entry.data) : null;
    };

    const savedList = cache.get(`assigns:${courseId}`);
    const savedRaw = savedList ? savedList.data.find((x) => x && x.cmid === cmid) : null;
    const savedAssignment = savedRaw ? parseAssignment(savedRaw) : null;

    // Instructions and dates from the last visit appear at once; the form stays hidden until the
    // fresh status has been checked. Never done right after our own save: that copy is outdated.
    if (savedAssignment && !flash) {
      clear(detailPane).append(renderAssign({
        courseId,
        assignment: savedAssignment,
        status: cachedStatus(savedAssignment.id),
        editability: { editable: false, reason: 'updating' },
        uploadState: 'unknown',
        maxBytes: 0,
        draftText: null,
        staleDraft: null,
        token: (auth.getSession() || session).token,
        offline: false,
        now: nowFn(),
        locale,
        flash: '',
        actions: { send: async () => { throw new MoodleError('signedout'); } },
        onDone: () => {},
        onTextInput: () => {},
        onDiscardDraft: () => {},
      }));
    } else {
      clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    }

    // Ask for the list and (when its id is already known) the status at the same time.
    const listS = settle(call((s) => api.getAssignments(s.token, courseId)));
    let statusS = savedAssignment ? settle(call((s) => api.getSubmissionStatus(s.token, savedAssignment.id))) : null;

    const listR = await listS;
    if (auth.epoch() !== epoch) return;
    let rawList;
    let offlineList = false;
    if (listR.ok) {
      rawList = assignmentsOf(listR.v);
      cache.set(`assigns:${courseId}`, rawList);
    } else {
      if (handleFatal(listR.e)) return;
      if (!savedList) {
        if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(listR.e)));
        return;
      }
      rawList = savedList.data;
      offlineList = true;
    }
    const rawA = rawList.find((x) => x && x.cmid === cmid);
    if (!rawA) {
      if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, S.assignNotFound));
      return;
    }
    const assignment = parseAssignment(rawA);

    let status = null;
    let isOffline = offlineList;
    if (offlineList) {
      status = cachedStatus(assignment.id);
    } else {
      if (!statusS || (savedAssignment && savedAssignment.id !== assignment.id)) {
        statusS = settle(call((s) => api.getSubmissionStatus(s.token, assignment.id)));
      }
      const st = await statusS;
      if (auth.epoch() !== epoch) return;
      if (st.ok) {
        cache.set(`status:${assignment.id}`, st.v);
        status = parseStatus(st.v);
      } else {
        if (handleFatal(st.e)) return;
        isOffline = true;
        status = cachedStatus(assignment.id);
      }
    }

    const maxBytes = uploadLimit(assignment);
    if (auth.epoch() !== epoch || !here()) return;
    const live = auth.getSession() || session;
    const up = cache.get('uploadOk');
    const base = status ? draftBase(status) : '';
    const draft = drafts.get(assignment.id);
    let draftText = null;
    let staleDraft = null;
    if (draft && status) {
      // Only restore automatically when it was typed against the same plain server text; otherwise offer it.
      if (status.text.simple && draft.base === base) draftText = draft.text;
      else staleDraft = { text: draft.text, savedAt: draft.savedAt };
    }
    clear(detailPane).append(renderAssign({
      courseId,
      assignment,
      status,
      editability: status && !isOffline ? editability(assignment, status, nowFn()) : { editable: false, reason: 'notallowed' },
      uploadState: up ? (up.data === true ? 'ok' : 'failed') : 'unknown',
      maxBytes,
      draftText,
      staleDraft,
      onDiscardDraft: () => drafts.remove(assignment.id),
      token: live.token,
      offline: isOffline,
      now: nowFn(),
      locale,
      flash,
      actions: { send: (input) => send(assignment, input, epoch) },
      onDone: (kind) => {
        if (auth.epoch() !== epoch || !onThis()) return; // signed out or navigated away: drop it
        pendingFlash = { cmid, kind };
        showRoute();
      },
      onTextInput: (t) => drafts.set(assignment.id, t, base),
    }));
  }

  async function showCourse(id, session, rid) {
    const epoch = auth.epoch();
    const alive = () => auth.epoch() === epoch && route() === id && rid === renderId;
    const savedSections = cache.get(`course:${id}`);
    const savedAssigns = cache.get(`assigns:${id}`);
    const savedDues = duesOf(savedAssigns ? savedAssigns.data : []);
    const paint = (sections, dues, flags) => {
      const info = courses.find((c) => c.id === id);
      const live = auth.getSession() || session; // token may have been renewed during a call
      const el = renderCourse({
        course: {
          id,
          fullname: info ? info.fullname : '',
          progress: info ? info.progress : null,
          sections: buildCourse(sections, live.token),
        },
        token: live.token,
        offline: Boolean(flags.offline),
        refreshing: Boolean(flags.refreshing),
        dues,
        now: nowFn(),
        locale,
      });
      clear(detailPane).append(el);
      return el;
    };

    // Last visit's content appears at once; the fresh copy replaces it only if it differs.
    let shown = null;
    if (savedSections) shown = paint(savedSections.data, savedDues, { refreshing: true });
    else clear(detailPane).append(h('p', { class: 'status' }, S.loading));

    // Contents and due dates are independent, so ask for both at the same time.
    const contentsS = settle(call((s) => api.getCourseContents(s.token, id)));
    const assignsS = settle(call((s) => api.getAssignments(s.token, id)));
    const [contents, assigns] = await Promise.all([contentsS, assignsS]);
    if (auth.epoch() !== epoch) return;

    if (!contents.ok) {
      if (handleFatal(contents.e)) return;
      if (!alive()) return;
      if (savedSections) paint(savedSections.data, savedDues, { offline: true });
      else clear(detailPane).append(renderBack(), h('p', { class: 'error' }, describeError(contents.e)));
      return;
    }
    cache.set(`course:${id}`, contents.v);
    let dues = savedDues;
    if (assigns.ok) {
      const list = assignmentsOf(assigns.v);
      cache.set(`assigns:${id}`, list);
      dues = duesOf(list);
    }
    if (!alive()) return;
    if (shown && savedSections && same(savedSections.data, contents.v) && same(savedDues, dues)) {
      const note = shown.querySelector('.refreshing');
      if (note) note.remove();
    } else {
      paint(contents.v, dues, {});
    }
  }

  async function showRoute() {
    const session = auth.getSession();
    if (!session || !shell) return;
    const v = view();
    const rid = (renderId += 1);
    shell.classList.toggle('has-detail', v.type !== 'list');
    renderList();
    if (v.type === 'diagnostics') {
      clear(detailPane).append(renderDiagnostics({
        run: async () => {
          try {
            const data = await runDiagnostics({ api, call, list: lastList });
            return buildReport({ ...data, timings: timings ? timings.list() : [] });
          } catch (err) {
            if (handleFatal(err)) return '';
            throw err;
          }
        },
        onUploadTest: uploadTest,
      }));
      return;
    }
    if (v.type === 'assign') {
      await showAssign(v.courseId, v.cmid, session, rid);
      return;
    }
    if (v.type === 'course') {
      await showCourse(v.id, session, rid);
      return;
    }
    clear(detailPane).append(h('p', { class: 'placeholder' }, S.pickCourse));
  }

  async function start() {
    win.addEventListener('hashchange', () => { if (shell) showRoute(); });
    if (auth.getSession()) await showShell();
    else showLogin();
  }

  return { start, login, logout, showRoute };
}
