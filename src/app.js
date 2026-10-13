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

export function createApp({
  root, api, auth, cache, win = globalThis.window,
  folderState = createFolderState(createMemoryStorage()),
  drafts = createDrafts(createMemoryStorage()),
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
  let siteMaxUpload = null;

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
    siteMaxUpload = null;
    pendingFlash = null;
    showLogin(message);
    if (win.location.hash) win.location.hash = '';
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
        fresh = await auth.relogin();
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
        fresh = await auth.relogin();
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

  async function loadCourses() {
    const epoch = auth.epoch();
    try {
      const res = await call((s) => loadCourseList({ api, token: s.token, userid: s.userid }));
      if (auth.epoch() !== epoch) return false; // signed out meanwhile: drop the result
      courses = res.courses;
      lastList = res;
      cache.set('courses', courses);
      offline = false;
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
    if (await loadCourses()) await showRoute();
    return undefined;
  }

  async function uploadLimit(assignment) {
    if (!assignment.plugins.file) return 0;
    if (siteMaxUpload === null) {
      try {
        const info = await call((s) => api.getSiteInfo(s.token));
        siteMaxUpload = Number(info && info.usermaxuploadfilesize) || 0;
      } catch {
        return assignment.maxBytes || 0; // unknown: the server enforces its own limit
      }
    }
    const limits = [siteMaxUpload, assignment.maxBytes].filter((n) => n > 0);
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
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}` }, '‹ ', S.backToCourse);
    let rawList;
    let offlineList = false;
    try {
      rawList = assignmentsOf(await call((s) => api.getAssignments(s.token, courseId)));
      if (auth.epoch() !== epoch) return;
      cache.set(`assigns:${courseId}`, rawList);
    } catch (err) {
      if (auth.epoch() !== epoch) return;
      if (handleFatal(err)) return;
      const saved = cache.get(`assigns:${courseId}`);
      if (!saved) {
        if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(err)));
        return;
      }
      rawList = saved.data;
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
    if (!offlineList) {
      try {
        const rawS = await call((s) => api.getSubmissionStatus(s.token, assignment.id));
        if (auth.epoch() !== epoch) return;
        status = parseStatus(rawS);
      } catch (err) {
        if (auth.epoch() !== epoch) return;
        if (handleFatal(err)) return;
        isOffline = true;
      }
    }
    const maxBytes = await uploadLimit(assignment);
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
      editability: status ? editability(assignment, status, nowFn()) : { editable: false, reason: 'notallowed' },
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

  async function showRoute() {
    const session = auth.getSession();
    if (!session || !shell) return;
    const v = view();
    const rid = (renderId += 1);
    const id = v.type === 'course' ? v.id : null;
    shell.classList.toggle('has-detail', v.type !== 'list');
    renderList();
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
        onUploadTest: uploadTest,
      }));
      return;
    }
    if (v.type === 'assign') {
      await showAssign(v.courseId, v.cmid, session, rid);
      return;
    }
    if (id === null) {
      clear(detailPane).append(h('p', { class: 'placeholder' }, S.pickCourse));
      return;
    }
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    const epoch = auth.epoch();
    let sections;
    let fromCache = false;
    try {
      sections = await call((s) => api.getCourseContents(s.token, id));
      if (auth.epoch() !== epoch) return; // signed out meanwhile: drop the result
      cache.set(`course:${id}`, sections);
    } catch (err) {
      if (auth.epoch() !== epoch) return;
      if (handleFatal(err)) return;
      const saved = cache.get(`course:${id}`);
      if (!saved) {
        if (route() === id) clear(detailPane).append(renderBack(), h('p', { class: 'error' }, describeError(err)));
        return;
      }
      sections = saved.data;
      fromCache = true;
    }
    if (route() !== id || rid !== renderId) return; // user navigated away while loading
    // Optional: due dates for assignments (never blocks or fails the course page).
    let dues = {};
    try {
      const list = assignmentsOf(await call((s) => api.getAssignments(s.token, id)));
      cache.set(`assigns:${id}`, list);
      dues = duesOf(list);
    } catch {
      const saved = cache.get(`assigns:${id}`);
      if (saved) dues = duesOf(saved.data);
    }
    if (auth.epoch() !== epoch || route() !== id || rid !== renderId) return;
    const info = courses.find((c) => c.id === id);
    const live = auth.getSession() || session; // token may have been renewed during the call
    clear(detailPane).append(renderCourse({
      course: {
        id,
        fullname: info ? info.fullname : '',
        progress: info ? info.progress : null,
        sections: buildCourse(sections, live.token),
      },
      token: live.token,
      offline: fromCache,
      dues,
      now: nowFn(),
      locale,
    }));
  }

  async function start() {
    win.addEventListener('hashchange', () => { if (shell) showRoute(); });
    if (auth.getSession()) await showShell();
    else showLogin();
  }

  return { start, login, logout, showRoute };
}
