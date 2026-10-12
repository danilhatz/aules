import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { isSafeHttpUrl } from '../sanitize.js';

function card(c, token, selectedId) {
  const raw = c.overviewfiles && c.overviewfiles[0] && c.overviewfiles[0].fileurl;
  const img = raw && withToken(raw, token);
  return h('li', { 'data-text': `${c.fullname} ${c.shortname || ''}`.toLowerCase() },
    h('a', { class: 'card', href: `#/course/${c.id}`, 'aria-current': c.id === selectedId ? 'page' : null },
      img && isSafeHttpUrl(img) ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb', 'aria-hidden': 'true' }),
      h('span', { class: 'meta' }, h('strong', {}, c.fullname), h('small', {}, c.shortname || '')),
      typeof c.progress === 'number' ? h('progress', { max: 100, value: Math.round(c.progress) }) : null));
}

export function renderCourseList({ courses, token, selectedId }) {
  const list = h('ul', { class: 'cards' }, courses.map((c) => card(c, token, selectedId)));
  const empty = h('p', { class: 'status' }, S.empty);
  empty.hidden = courses.length > 0;
  const search = h('input', {
    type: 'search', class: 'search', placeholder: S.search, 'aria-label': S.search,
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const li of list.children) {
        const hit = !q || li.dataset.text.includes(q);
        li.hidden = !hit;
        if (hit) shown += 1;
      }
      empty.hidden = shown > 0;
    },
  });
  return h('div', { class: 'courses' }, search, empty, list);
}
