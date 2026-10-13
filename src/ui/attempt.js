import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';
import { withToken } from '../content.js';
import { sanitizeQuestionHtml, collectAnswers, snapshotAnswers, restoreSnapshot } from '../qhtml.js';
import { SUPPORTED_QTYPES, formatTimeLeft } from '../quiz.js';

const defaultClock = {
  now: () => Math.floor(Date.now() / 1000),
  every: (fn) => setInterval(fn, 1000),
  stop: (handle) => clearInterval(handle),
};

function errorText(err) {
  const base = describeError(err);
  const detail = err && err.message && err.message !== err.code && !S.errors[err.code] ? ` ${err.message}` : '';
  return base + detail;
}

const backLink = (p) => h('a', { class: 'back', href: `#/course/${p.courseId}/quiz/${p.cmid}` }, '‹ ', S.backToQuiz);

export function renderAttempt(p) {
  const head = h('header', { class: 'bar' }, backLink(p), h('h2', {}, p.quiz.name));
  if (p.questions.some((q) => !SUPPORTED_QTYPES.has(q.type))) {
    return h('article', { class: 'course attempt' }, head,
      h('div', { class: 'note-box' }, h('p', { class: 'note' }, S.attemptUnsupported),
        h('a', { class: 'btn secondary link-btn', href: p.openUrl, target: '_blank', rel: 'noopener noreferrer' }, S.openInAules)));
  }
  const clock = p.clock || defaultClock;
  const rewriteUrl = (u) => withToken(u, p.token);

  const container = h('div', { class: 'questions' });
  for (const q of p.questions) {
    const sec = h('section', { class: 'question', 'data-slot': String(q.slot) });
    sec.innerHTML = sanitizeQuestionHtml(q.html, { rewriteUrl, interactive: true });
    container.append(sec);
  }
  if (p.snapshot) restoreSnapshot(container, p.snapshot);
  const notify = () => p.onSnapshot(snapshotAnswers(container));
  container.addEventListener('input', notify);
  container.addEventListener('change', notify);

  let busy = false;
  let timeUp = false;
  const msg = h('p', { class: 'form-msg', role: 'alert' }, '');
  const say = (t) => { msg.textContent = t; };
  const fields = h('fieldset', { class: 'answer-fields' }, container);
  const buttons = [];
  const setBusy = (b) => { busy = b; fields.disabled = b || timeUp; for (const x of buttons) x.disabled = b; };
  const answers = () => collectAnswers(container);
  const run = async (fn, onOk) => {
    if (busy) return;
    setBusy(true);
    say('');
    try {
      onOk(await fn());
    } catch (err) {
      if (err && err.code === 'signedout') return;
      if (err && err.code === 'unconfirmed') { p.onDone('unknown'); return; }
      say(errorText(err));
      setBusy(false);
    }
  };
  const button = (label, cls, onclick) => {
    const b = h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick }, label);
    buttons.push(b);
    return b;
  };

  const prevBtn = p.page > 0 && !p.sequential
    ? button(S.quizPrev, 'secondary', () => run(() => p.actions.go(answers(), p.page - 1), () => p.onNavigate(p.page - 1)))
    : null;
  const saveBtn = button(S.quizSave, 'secondary', () => run(() => p.actions.save(answers()), () => { say(S.savedMsg); setBusy(false); }));
  const nextBtn = p.nextPage >= 0
    ? button(S.quizNext, '', () => run(() => p.actions.go(answers(), p.nextPage), () => p.onNavigate(p.nextPage)))
    : null;

  const summary = h('p', {}, '');
  const confirmBtn = button(S.confirmSubmit, 'confirm-btn', () => run(
    () => p.actions.finish(answers(), { timeup: timeUp }),
    () => p.onDone('finished'),
  ));
  const cancelBtn = button(S.cancel, 'secondary', () => { confirm.hidden = true; });
  const confirm = h('div', { class: 'confirm', hidden: true, role: 'group' }, summary, confirmBtn, cancelBtn);
  const finishBtn = button(S.quizFinish, '', async () => {
    if (busy) return;
    setBusy(true);
    say('');
    try {
      const s = await p.actions.loadSummary();
      summary.textContent = S.summaryText.replace('{done}', String(s.answered)).replace('{total}', String(s.total));
    } catch {
      summary.textContent = S.summaryUnknown;
    }
    confirm.hidden = false;
    setBusy(false);
  });

  const timer = p.endTime ? h('p', { class: 'timer' }, '') : null;
  const timeNote = h('p', { class: 'time-up note', hidden: true }, S.timeUp);
  const tick = () => {
    const left = p.endTime - clock.now();
    if (timer) timer.textContent = `${S.timeLeft}: ${formatTimeLeft(left)}`;
    if (left <= 0 && !timeUp) {
      timeUp = true;
      fields.disabled = true;
      timeNote.hidden = false;
      for (const b of [prevBtn, saveBtn, nextBtn]) if (b) b.hidden = true;
      finishBtn.textContent = S.quizSubmitNow;
    }
  };

  const bar = h('div', { class: 'attempt-bar' }, prevBtn, saveBtn, nextBtn, finishBtn);
  const el = h('article', { class: 'course attempt' }, head, timer, timeNote, fields, msg, confirm, bar);
  if (p.endTime) {
    tick();
    let wasConnected = false;
    const handle = clock.every(() => {
      if (el.isConnected) wasConnected = true;
      else if (wasConnected) { clock.stop(handle); return; }
      tick();
    });
  }
  return el;
}

export function renderReview(p) {
  const rewriteUrl = (u) => withToken(u, p.token);
  const body = h('div', { class: 'questions' });
  for (const q of p.questions) {
    const sec = h('section', { class: 'question', 'data-number': String(q.number) });
    sec.innerHTML = sanitizeQuestionHtml(q.html, { rewriteUrl, interactive: false });
    body.append(sec);
  }
  return h('article', { class: 'course review' },
    h('header', { class: 'bar' }, backLink(p), h('h2', {}, `${S.reviewTitle}: ${p.quiz.name}`)),
    p.grade ? h('p', { class: 'grade' }, `${S.reviewGrade}: ${p.grade}`) : null,
    p.message ? h('p', { class: 'note' }, p.message) : null,
    body);
}
