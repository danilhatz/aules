import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';
import { withToken } from '../content.js';
import { sanitizeHtml } from '../sanitize.js';
import { formatDue } from '../assign.js';
import { attemptGrade } from '../quiz.js';

const fmt = (n) => String(Math.round(n * 100) / 100);

function errorText(err) {
  const base = describeError(err);
  const detail = err && err.message && err.message !== err.code && !S.errors[err.code] ? ` ${err.message}` : '';
  return base + detail;
}

const openLink = (p) => h('a', { class: 'btn secondary link-btn', href: p.openUrl, target: '_blank', rel: 'noopener noreferrer' }, S.openInAules);

function startBlock(p) {
  let busy = false;
  const msg = h('p', { class: 'form-msg', role: 'alert' }, '');
  const cancel = h('button', { type: 'button', class: 'btn secondary', onclick: () => { confirm.hidden = true; } }, S.cancel);
  const yes = h('button', {
    type: 'button', class: 'btn confirm-btn',
    onclick: async () => {
      if (busy) return;
      busy = true; yes.disabled = true; cancel.disabled = true; msg.textContent = '';
      try {
        const attemptId = await p.actions.start();
        p.onStarted(attemptId);
      } catch (err) {
        if (err && err.code === 'signedout') return;
        if (err && err.code === 'unconfirmed') { p.onDone('unknown'); return; }
        msg.textContent = errorText(err);
        busy = false; yes.disabled = false; cancel.disabled = false;
      }
    },
  }, S.confirmStartYes);
  const minutes = p.quiz.timeLimit ? Math.ceil(p.quiz.timeLimit / 60) : 0;
  const confirm = h('div', { class: 'confirm', hidden: true, role: 'group' },
    h('p', {}, S.confirmStart),
    minutes ? h('p', {}, S.confirmStartTime.replace('{min}', String(minutes))) : null,
    yes, cancel);
  const start = h('button', { type: 'button', class: 'btn', onclick: () => { msg.textContent = ''; confirm.hidden = false; } }, S.quizStart);
  return h('div', { class: 'start-block' }, start, confirm, msg);
}

function startSection(p) {
  const c = p.check;
  if (p.offline) return h('p', { class: 'note' }, S.offlineNoEdit);
  if (!p.fresh) return h('p', { class: 'note' }, S.quizChecking);
  switch (c.mode) {
    case 'start': return startBlock(p);
    case 'continue':
      return h('a', { class: 'btn', href: `#/course/${p.courseId}/quiz/${p.cmid}/attempt/${c.attemptId}` }, S.quizContinue);
    case 'overdue': return h('div', { class: 'note-box' }, h('p', { class: 'note' }, S.quizOverdue), openLink(p));
    case 'unsupported':
      return h('div', { class: 'note-box' },
        h('p', { class: 'note' }, S.quizUnsupported),
        c.unsupportedTypes.length ? h('p', { class: 'note' }, `${S.quizTypes} ${c.unsupportedTypes.join(', ')}`) : null,
        c.unsupportedRules.length ? h('p', { class: 'note' }, `${S.quizRules} ${c.unsupportedRules.join(', ')}`) : null,
        c.preflight ? h('p', { class: 'note' }, S.quizPreflight) : null,
        openLink(p));
    case 'blocked':
      return h('div', { class: 'note-box' },
        h('p', { class: 'note' }, S.quizBlocked),
        ...c.messages.map((m) => h('p', { class: 'note' }, m)));
    default: return h('div', { class: 'note-box' }, h('p', { class: 'note' }, S.quizUnknown), openLink(p));
  }
}

function attemptsList(p) {
  if (!p.attempts.length) return h('p', { class: 'note' }, S.noAttempts);
  return h('ul', { class: 'attempts' }, p.attempts.map((a) => {
    const grade = attemptGrade(a, p.quiz);
    const link = a.state === 'finished'
      ? h('a', { href: `#/course/${p.courseId}/quiz/${p.cmid}/review/${a.id}` }, S.quizReview)
      : null;
    return h('li', {},
      h('span', {}, `${S.attemptLabel} ${a.number} · ${S.quizStates[a.state] || S.quizStates.unknown}`),
      grade !== null ? h('span', { class: 'grade' }, ` · ${fmt(grade)} / ${fmt(p.quiz.maxGrade)}`) : null,
      link ? ' ' : null, link);
  }));
}

export function renderQuiz(p) {
  const q = p.quiz;
  const opts = { rewriteUrl: (u) => withToken(u, p.token) };
  const intro = h('div', { class: 'html intro' });
  intro.innerHTML = sanitizeHtml(q.introHtml, opts);
  const close = formatDue(q.timeClose, p.now, p.locale);
  const closeText = !q.timeClose ? null
    : close.overdue ? `${S.closedLabel}: ${close.absolute}`
      : `${S.closesLabel}: ${close.relative} · ${close.absolute}`;
  const flashText = { finished: S.finishedMsg, unknown: S.unconfirmed }[p.flash] || '';
  return h('article', { class: 'course quiz' },
    h('header', { class: 'bar' }, h('a', { class: 'back', href: `#/course/${p.courseId}` }, '‹ ', S.backToCourse), h('h2', {}, q.name)),
    ...(flashText ? [h('p', { class: `banner flash flash-${p.flash}`, role: 'status' }, flashText)] : []),
    ...(p.offline ? [h('p', { class: 'banner' }, S.offline)] : []),
    h('ul', { class: 'quiz-meta' },
      closeText ? h('li', { class: close.overdue ? 'due overdue' : 'due' }, closeText) : null,
      q.timeLimit ? h('li', {}, `${S.timeLimitLabel}: ${Math.ceil(q.timeLimit / 60)} ${S.minutes}`) : null,
      h('li', {}, `${S.attemptsAllowedLabel}: ${q.attemptsAllowed || S.unlimited}`),
      p.bestGrade.has && p.bestGrade.grade !== null ? h('li', {}, `${S.bestGradeLabel}: ${fmt(p.bestGrade.grade)} / ${fmt(q.maxGrade)}`) : null),
    intro,
    h('section', { class: 'start' }, startSection(p)),
    h('section', { class: 'attempt-list' }, h('h3', {}, S.quizAttempts), attemptsList(p)));
}
