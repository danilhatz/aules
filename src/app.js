import { clear, h } from './ui/dom.js';
import { renderLogin } from './ui/login.js';
import { renderCourseList } from './ui/courses.js';
import { renderCourse, renderBack } from './ui/course.js';
import { buildCourse } from './content.js';
import { describeError } from './errors.js';
import { MoodleError } from './api.js';
import { STRINGS as S } from './strings.js';

export function createApp({ root, api, auth, cache, win = globalThis.window }) {
  let courses = [];
  let offline = false;
  let shell = null;
  let listPane = null;
  let detailPane = null;

  const route = () => {
    const m = /^#\/course\/(\d+)$/.exec(win.location.hash);
    return m ? Number(m[1]) : null;
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
    courses = [];
    showLogin(message);
    if (win.location.hash) win.location.hash = '';
  }

  // Run an authenticated call. On an expired token, silently renew it from the
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
        h('button', { class: 'link', type: 'button', onclick: () => logout() }, S.logout)),
      ...(offline ? [h('p', { class: 'banner' }, S.offline)] : []),
      renderCourseList({ courses, token, selectedId: route() }));
  }

  async function loadCourses() {
    const epoch = auth.epoch();
    try {
      const fetched = await call((s) => api.getCourses(s.token, s.userid));
      if (auth.epoch() !== epoch) return false; // signed out meanwhile: drop the result
      courses = fetched;
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

  async function showRoute() {
    const session = auth.getSession();
    if (!session || !shell) return;
    const id = route();
    shell.classList.toggle('has-detail', id !== null);
    renderList();
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
    if (route() !== id) return; // user navigated away while loading
    const info = courses.find((c) => c.id === id);
    const live = auth.getSession() || session; // token may have been renewed during the call
    clear(detailPane).append(renderCourse({
      course: { id, fullname: info ? info.fullname : '', sections: buildCourse(sections, live.token) },
      token: live.token,
      offline: fromCache,
    }));
  }

  async function start() {
    win.addEventListener('hashchange', () => { if (shell) showRoute(); });
    if (auth.getSession()) await showShell();
    else showLogin();
  }

  return { start, login, logout, showRoute };
}
