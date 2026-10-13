import { clear, h } from './ui/dom.js';
import { renderLogin } from './ui/login.js';
import { renderCourseList } from './ui/courses.js';
import { renderCourse, renderBack } from './ui/course.js';
import { renderDiagnostics } from './ui/diagnostics.js';
import { renderAssign } from './ui/assign.js';
import { renderQuiz } from './ui/quiz.js';
import { renderAttempt, renderReview } from './ui/attempt.js';
import { buildCourse } from './content.js';
import { loadCourseList } from './courses.js';
import { runDiagnostics, buildReport } from './diagnostics.js';
import { parseAssignment, parseStatus, editability, draftBase } from './assign.js';
import { performSubmission } from './submit.js';
import { parseQuiz, parseAttempts, parseBestGrade, startCheck } from './quiz.js';
import { createAttemptStore } from './attemptstore.js';
import { SITE_URL } from './config.js';
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
  attemptStore = createAttemptStore(createMemoryStorage()),
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
  let pendingQuizFlash = null; // { key, kind }
  let renewing = null; // one shared silent renewal, however many requests hit an expired token at once

  const view = () => {
    const hash = win.location.hash;
    if (hash === '#/diagnostics') return { type: 'diagnostics' };
    let m = /^#\/course\/(\d+)\/assign\/(\d+)$/.exec(hash);
    if (m) return { type: 'assign', courseId: Number(m[1]), cmid: Number(m[2]) };
    m = /^#\/course\/(\d+)\/quiz\/(\d+)\/attempt\/(\d+)(?:\/(\d+))?$/.exec(hash);
    if (m) return { type: 'attempt', courseId: Number(m[1]), cmid: Number(m[2]), attemptId: Number(m[3]), page: m[4] === undefined ? null : Number(m[4]) };
    m = /^#\/course\/(\d+)\/quiz\/(\d+)\/review\/(\d+)$/.exec(hash);
    if (m) return { type: 'review', courseId: Number(m[1]), cmid: Number(m[2]), attemptId: Number(m[3]) };
    m = /^#\/course\/(\d+)\/quiz\/(\d+)$/.exec(hash);
    if (m) return { type: 'quiz', courseId: Number(m[1]), cmid: Number(m[2]) };
    m = /^#\/course\/(\d+)$/.exec(hash);
    return m ? { type: 'course', id: Number(m[1]) } : { type: 'list' };
  };
  const route = () => {
    const v = view();
    if (v.type === 'course') return v.id;
    return ['assign', 'quiz', 'attempt', 'review'].includes(v.type) ? v.courseId : null;
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
    attemptStore.clear();
    pendingQuizFlash = null;
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
    // Once a write went out (or may have), the saved status describes the world before it: drop it so
    // a failed reload can never show the old answer as current.
    const forgetStatus = () => { if (auth.epoch() === epoch) cache.remove(`status:${assignment.id}`); };
    let result;
    try {
      result = await performSubmission({ api, write, assignment, input });
    } catch (err) {
      if (err && err.code === 'unconfirmed') forgetStatus();
      throw err;
    }
    forgetStatus();
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

  const quizOpenUrl = (cmid) => `${SITE_URL}/mod/quiz/view.php?id=${cmid}`;
  const guardedWrite = (epoch) => (fn) => {
    if (auth.epoch() !== epoch) throw new MoodleError('signedout');
    return callWrite(fn);
  };
  // After a write was sent, a lost or garbled reply means we do not know the outcome.
  const sentOnce = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e && (e.code === 'network' || e.code === 'badresponse')) throw new MoodleError('unconfirmed');
      throw e;
    }
  };

  async function showQuiz(courseId, cmid, session, rid) {
    const epoch = auth.epoch();
    const flashKey = `quiz:${cmid}`;
    const flash = pendingQuizFlash && pendingQuizFlash.key === flashKey ? pendingQuizFlash.kind : '';
    pendingQuizFlash = null;
    const here = () => { const v = view(); return v.type === 'quiz' && v.cmid === cmid && rid === renderId && auth.epoch() === epoch; };
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}` }, '‹ ', S.backToCourse);
    const token = () => (auth.getSession() || session).token;
    const savedList = cache.get(`quizzes:${courseId}`);
    const savedRaw = savedList ? savedList.data.find((x) => x && x.coursemodule === cmid) : null;
    const savedQuiz = savedRaw ? parseQuiz(savedRaw) : null;
    const savedInfo = savedQuiz ? cache.get(`quizinfo:${savedQuiz.id}`) : null;
    const paint = (quiz, attempts, best, check, flags) => {
      clear(detailPane).append(renderQuiz({
        courseId, cmid, quiz, attempts, bestGrade: best, check, fresh: Boolean(flags.fresh), offline: Boolean(flags.offline),
        now: nowFn(), locale, flash: flags.fresh ? flash : '', token: token(), openUrl: quizOpenUrl(cmid),
        actions: {
          start: async () => {
            const r = await sentOnce(() => guardedWrite(epoch)((s) => api.startAttempt(s.token, quiz.id)));
            if (auth.epoch() !== epoch) throw new MoodleError('signedout');
            cache.remove(`quizinfo:${quiz.id}`);
            return r.attempt.id;
          },
        },
        onStarted: (attemptId) => {
          if (auth.epoch() !== epoch) return;
          win.location.hash = `#/course/${courseId}/quiz/${cmid}/attempt/${attemptId}`;
        },
        onDone: (kind) => {
          if (auth.epoch() !== epoch || !here()) return;
          pendingQuizFlash = { key: flashKey, kind };
          showRoute();
        },
      }));
    };
    const parsedSaved = () => ({
      attempts: savedInfo ? parseAttempts(savedInfo.data.attempts) : [],
      best: savedInfo ? parseBestGrade(savedInfo.data.best) : { has: false, grade: null },
    });

    // Saved copy first, read-only: Start is only ever offered from fresh checks.
    if (savedQuiz && !flash) {
      const s = parsedSaved();
      paint(savedQuiz, s.attempts, s.best, startCheck({}), { fresh: false });
    } else {
      clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    }

    const fetchInfo = (id) => Promise.all([
      settle(call((s) => api.getQuizAccess(s.token, id))),
      settle(call((s) => api.getQuizQtypes(s.token, id))),
      settle(call((s) => api.getAttemptAccess(s.token, id, 0))),
      settle(call((s) => api.getUserAttempts(s.token, id))),
      settle(call((s) => api.getBestGrade(s.token, id))),
    ]);
    const listS = settle(call((s) => api.getQuizzes(s.token, courseId)));
    let infoP = savedQuiz ? fetchInfo(savedQuiz.id) : null;

    const listR = await listS;
    if (auth.epoch() !== epoch) return;
    let rawList;
    let offlineList = false;
    if (listR.ok) {
      rawList = Array.isArray(listR.v && listR.v.quizzes) ? listR.v.quizzes : [];
      cache.set(`quizzes:${courseId}`, rawList);
    } else {
      if (handleFatal(listR.e)) return;
      if (!savedList) {
        if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(listR.e)));
        return;
      }
      rawList = savedList.data;
      offlineList = true;
    }
    const rawQ = rawList.find((x) => x && x.coursemodule === cmid);
    if (!rawQ) {
      if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, S.quizNotFound));
      return;
    }
    const quiz = parseQuiz(rawQ);
    if (offlineList) {
      if (!here()) return;
      const s = parsedSaved();
      paint(quiz, s.attempts, s.best, startCheck({}), { fresh: true, offline: true });
      return;
    }
    if (!infoP || (savedQuiz && savedQuiz.id !== quiz.id)) infoP = fetchInfo(quiz.id);
    const [access, qtypes, attemptAccess, attemptsR, bestR] = await infoP;
    if (auth.epoch() !== epoch) return;
    for (const r of [access, qtypes, attemptAccess, attemptsR, bestR]) {
      if (!r.ok && handleFatal(r.e)) return;
    }
    if (attemptsR.ok && bestR.ok) cache.set(`quizinfo:${quiz.id}`, { attempts: attemptsR.v, best: bestR.v });
    if (!here()) return;
    const attempts = attemptsR.ok ? parseAttempts(attemptsR.v) : (savedInfo ? parseAttempts(savedInfo.data.attempts) : []);
    const best = bestR.ok ? parseBestGrade(bestR.v) : { has: false, grade: null };
    const check = startCheck({
      quiz,
      access: access.ok ? access.v : null,
      qtypes: qtypes.ok ? qtypes.v : null,
      attemptAccess: attemptAccess.ok ? attemptAccess.v : null,
      attempts: attemptsR.ok ? attempts : null,
    });
    paint(quiz, attempts, best, check, { fresh: true });
  }

  async function showAttempt(courseId, cmid, attemptId, pageParam, session, rid) {
    const epoch = auth.epoch();
    const here = () => { const v = view(); return v.type === 'attempt' && v.attemptId === attemptId && rid === renderId && auth.epoch() === epoch; };
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}/quiz/${cmid}` }, '‹ ', S.backToQuiz);
    const fail = (err) => { if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(err))); };
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));

    // The quiz id is needed for the time limit; it is usually already saved from the quiz screen.
    const savedList = cache.get(`quizzes:${courseId}`);
    let rawQ = savedList ? savedList.data.find((x) => x && x.coursemodule === cmid) : null;
    if (!rawQ) {
      const lr = await settle(call((s) => api.getQuizzes(s.token, courseId)));
      if (auth.epoch() !== epoch) return;
      if (!lr.ok) { if (handleFatal(lr.e)) return; fail(lr.e); return; }
      const list = Array.isArray(lr.v && lr.v.quizzes) ? lr.v.quizzes : [];
      cache.set(`quizzes:${courseId}`, list);
      rawQ = list.find((x) => x && x.coursemodule === cmid);
    }
    if (!rawQ) { if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, S.quizNotFound)); return; }
    const quiz = parseQuiz(rawQ);

    const accessS = settle(call((s) => api.getAttemptAccess(s.token, quiz.id, attemptId)));
    let page = pageParam;
    if (page === null) {
      const ar = await settle(call((s) => api.getUserAttempts(s.token, quiz.id)));
      if (auth.epoch() !== epoch) return;
      if (!ar.ok) { if (handleFatal(ar.e)) return; fail(ar.e); return; }
      const mine = parseAttempts(ar.v).find((a) => a.id === attemptId);
      page = mine ? mine.currentPage : 0;
    }
    const dataR = await settle(call((s) => api.getAttemptData(s.token, attemptId, page)));
    const accessR = await accessS;
    if (auth.epoch() !== epoch) return;
    if (!dataR.ok) { if (handleFatal(dataR.e)) return; fail(dataR.e); return; }
    if (!here()) return;
    const data = dataR.v;
    const questions = (Array.isArray(data.questions) ? data.questions : []).map((q) => ({ slot: q.slot, number: q.number, type: q.type, html: q.html || '' }));
    const endTime = accessR.ok && accessR.v && Number(accessR.v.endtime) > 0 ? Number(accessR.v.endtime) : 0;
    const write = guardedWrite(epoch);
    // After a write completes, only act if the user is still where they were (or already back on the quiz).
    const goTo = (target) => {
      if (!here()) return;
      win.location.hash = `#/course/${courseId}/quiz/${cmid}/attempt/${attemptId}/${target}`;
    };
    const leaveToQuiz = (kind) => {
      if (auth.epoch() !== epoch) return;
      const target = `#/course/${courseId}/quiz/${cmid}`;
      const v = view();
      const onQuizScreen = v.type === 'quiz' && v.cmid === cmid;
      if (!here() && !onQuizScreen) return; // the user went elsewhere: drop the message
      pendingQuizFlash = { key: `quiz:${cmid}`, kind };
      if (win.location.hash === target) showRoute(); // same hash fires no hashchange: reload explicitly
      else win.location.hash = target; // the hashchange handler loads the quiz screen
    };
    clear(detailPane).append(renderAttempt({
      courseId, cmid, quiz, page, nextPage: Number.isInteger(data.nextpage) ? data.nextpage : -1,
      sequential: quiz.sequential, questions, endTime, snapshot: attemptStore.get(attemptId, page),
      token: (auth.getSession() || session).token, openUrl: quizOpenUrl(cmid),
      actions: {
        save: async (answers) => {
          await sentOnce(() => write((s) => api.saveAttempt(s.token, attemptId, answers)));
          if (auth.epoch() !== epoch) throw new MoodleError('signedout');
          attemptStore.removePage(attemptId, page); // saved on the server: the local copy must not override it later
        },
        go: async (answers) => {
          await sentOnce(() => write((s) => api.processAttempt(s.token, attemptId, answers, { finish: false })));
          if (auth.epoch() !== epoch) throw new MoodleError('signedout');
          attemptStore.removePage(attemptId, page);
        },
        loadSummary: async () => {
          const r = await call((s) => api.getAttemptSummary(s.token, attemptId));
          // Descriptions are not questions; "invalid" (an incomplete answer) is not answered either.
          const qs = (Array.isArray(r && r.questions) ? r.questions : []).filter((q) => q && q.type !== 'description');
          return { total: qs.length, answered: qs.filter((q) => !['todo', 'gaveup', 'invalid'].includes(q.state)).length };
        },
        finish: async (answers, { timeup }) => {
          await sentOnce(() => write((s) => api.processAttempt(s.token, attemptId, answers, { finish: true, timeup })));
          if (auth.epoch() !== epoch) throw new MoodleError('signedout');
          cache.remove(`quizinfo:${quiz.id}`);
          attemptStore.remove(attemptId);
        },
      },
      onSnapshot: (snap) => attemptStore.set(attemptId, page, snap),
      onNavigate: goTo,
      onDone: (kind) => leaveToQuiz(kind),
    }));
  }

  async function showReview(courseId, cmid, attemptId, session, rid) {
    const epoch = auth.epoch();
    const here = () => { const v = view(); return v.type === 'review' && v.attemptId === attemptId && rid === renderId && auth.epoch() === epoch; };
    const back = () => h('a', { class: 'back', href: `#/course/${courseId}/quiz/${cmid}` }, '‹ ', S.backToQuiz);
    clear(detailPane).append(h('p', { class: 'status' }, S.loading));
    const savedList = cache.get(`quizzes:${courseId}`);
    const rawQ = savedList ? savedList.data.find((x) => x && x.coursemodule === cmid) : null;
    const rr = await settle(call((s) => api.getAttemptReview(s.token, attemptId)));
    if (auth.epoch() !== epoch) return;
    if (!rr.ok) {
      if (handleFatal(rr.e)) return;
      if (here()) clear(detailPane).append(back(), h('p', { class: 'error' }, describeError(rr.e)));
      return;
    }
    if (!here()) return;
    const warn = Array.isArray(rr.v.warnings) && rr.v.warnings[0] ? String(rr.v.warnings[0].message || '') : '';
    const questions = (Array.isArray(rr.v.questions) ? rr.v.questions : []).map((q) => ({ number: q.number, html: q.html || '' }));
    clear(detailPane).append(renderReview({
      courseId, cmid, quiz: rawQ ? parseQuiz(rawQ) : { name: '' }, grade: rr.v.grade == null ? '' : String(rr.v.grade),
      questions, message: warn, token: (auth.getSession() || session).token,
    }));
  }

  async function showCourse(id, session, rid) {
    const epoch = auth.epoch();
    const alive = () => auth.epoch() === epoch && route() === id && rid === renderId;
    const savedSections = cache.get(`course:${id}`);
    const savedAssigns = cache.get(`assigns:${id}`);
    const savedDues = duesOf(savedAssigns ? savedAssigns.data : []);
    const closesOf = () => {
      const e = cache.get(`quizzes:${id}`);
      return e ? Object.fromEntries(e.data.filter((q) => q && q.coursemodule != null).map((q) => [q.coursemodule, Number(q.timeclose) || 0])) : {};
    };
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
        closes: closesOf(),
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
    // Closing times of quizzes are refreshed quietly (shown from the next visit; no repaint).
    if (contents.v.some((sec) => sec && Array.isArray(sec.modules) && sec.modules.some((m) => m && m.modname === 'quiz'))) {
      call((s) => api.getQuizzes(s.token, id))
        .then((r) => { if (auth.epoch() === epoch && Array.isArray(r && r.quizzes)) cache.set(`quizzes:${id}`, r.quizzes); })
        .catch(() => { /* optional */ });
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
    if (v.type === 'quiz') { await showQuiz(v.courseId, v.cmid, session, rid); return; }
    if (v.type === 'attempt') { await showAttempt(v.courseId, v.cmid, v.attemptId, v.page, session, rid); return; }
    if (v.type === 'review') { await showReview(v.courseId, v.cmid, v.attemptId, session, rid); return; }
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
