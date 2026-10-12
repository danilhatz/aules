import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { sanitizeHtml } from '../sanitize.js';

export function renderBack() {
  return h('a', { class: 'back', href: '#/' }, '‹ ', S.back);
}

function html(cls, raw, opts) {
  const d = h('div', { class: cls });
  d.innerHTML = sanitizeHtml(raw, opts);
  return d;
}

function renderModule(m, opts) {
  if (m.kind === 'label') return h('li', { class: 'mod label' }, html('html', m.description, opts));
  const linkOnly = (m.kind === 'url' || m.kind === 'page') && m.links.length > 0;
  return h('li', { class: `mod ${m.kind}` },
    linkOnly ? null : h('span', { class: 'mod-name' }, m.name),
    m.unsupported ? h('small', { class: 'muted' }, S.unsupported) : null,
    m.description ? html('html small', m.description, opts) : null,
    m.links.length
      ? h('ul', { class: 'links' }, m.links.map((l) => h('li', {}, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label))))
      : null);
}

function renderSection(s, open, opts) {
  return h('details', { class: 'section', open },
    h('summary', {}, s.name),
    s.summary ? html('html', s.summary, opts) : null,
    h('ul', { class: 'modules' }, s.modules.map((m) => renderModule(m, opts))));
}

export function renderCourse({ course, token, offline }) {
  const opts = { rewriteUrl: (u) => withToken(u, token) };
  const firstOpen = course.sections.findIndex((s) => s.modules.length);
  const body = course.sections.length
    ? course.sections.map((s, i) => renderSection(s, i === firstOpen, opts))
    : h('p', { class: 'status' }, S.noContent);
  return h('article', { class: 'course' },
    h('header', { class: 'bar' }, renderBack(), h('h2', {}, course.fullname)),
    offline ? h('p', { class: 'banner' }, S.offline) : null,
    body);
}
