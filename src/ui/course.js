import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { sanitizeHtml } from '../sanitize.js';
import { formatDue } from '../assign.js';

export function renderBack() {
  return h('a', { class: 'back', href: '#/' }, '‹ ', S.back);
}

function html(cls, raw, opts) {
  const d = h('div', { class: cls });
  d.innerHTML = sanitizeHtml(raw, opts);
  return d;
}

function chip(m) {
  if (m.kind === 'label') return null;
  return h('span', { class: `chip chip-${m.modname || m.kind}` }, S.types[m.modname] || S.types.other);
}

function renderModule(m, opts, ctx) {
  if (m.kind === 'label') return h('li', { class: 'mod label' }, html('html', m.description, opts));
  if (m.kind === 'assign') {
    const due = ctx.dues && ctx.dues[m.id] ? formatDue(ctx.dues[m.id], ctx.now, ctx.locale) : null;
    return h('li', { class: 'mod assign' },
      h('div', { class: 'mod-head' }, chip(m), h('a', { class: 'assign-link', href: `#/course/${ctx.courseId}/assign/${m.id}` }, m.name)),
      due && due.has ? h('small', { class: due.overdue ? 'due overdue' : 'due' }, `${due.relative} · ${due.absolute}`) : null,
      m.description ? html('html small', m.description, opts) : null);
  }
  const linkOnly = (m.kind === 'url' || m.kind === 'page') && m.links.length > 0;
  return h('li', { class: `mod ${m.kind}` },
    h('div', { class: 'mod-head' }, chip(m), linkOnly ? null : h('span', { class: 'mod-name' }, m.name)),
    m.unsupported ? h('small', { class: 'muted soon' }, m.soon ? S.comingSoon : S.unsupported) : null,
    m.description ? html('html small', m.description, opts) : null,
    m.links.length
      ? h('ul', { class: 'links' }, m.links.map((l) => h('li', {}, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label))))
      : null);
}

function renderSection(s, open, opts, ctx) {
  return h('details', { class: 'section unit', open },
    h('summary', {},
      s.number > 0 ? h('span', { class: 'unit-no', 'aria-hidden': 'true' }, String(s.number)) : null,
      h('span', { class: 'unit-name' }, s.name)),
    s.summary ? html('html', s.summary, opts) : null,
    h('ul', { class: 'modules' }, s.modules.map((m) => renderModule(m, opts, ctx))));
}

export function renderCourse({ course, token, offline, dues, now, locale }) {
  const opts = { rewriteUrl: (u) => withToken(u, token) };
  const ctx = { courseId: course.id, dues, now, locale };
  const firstOpen = course.sections.findIndex((s) => s.modules.length);
  const body = course.sections.length
    ? course.sections.map((s, i) => renderSection(s, i === firstOpen, opts, ctx))
    : h('p', { class: 'status' }, S.noContent);
  return h('article', { class: 'course' },
    h('header', { class: 'bar' }, renderBack(), h('h2', {}, course.fullname)),
    typeof course.progress === 'number' ? h('progress', { class: 'course-progress', max: 100, value: Math.round(course.progress) }) : null,
    offline ? h('p', { class: 'banner' }, S.offline) : null,
    body);
}
