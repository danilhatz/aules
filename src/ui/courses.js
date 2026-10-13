import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { withToken } from '../content.js';
import { isSafeHttpUrl } from '../sanitize.js';
import { groupCourses } from '../courses.js';

function card(c, token, selectedId) {
  const img = c.image && withToken(c.image, token);
  return h('li', { 'data-text': `${c.fullname} ${c.shortname || ''} ${c.category || ''}`.toLowerCase() },
    h('a', { class: 'card', href: `#/course/${c.id}`, 'aria-current': c.id === selectedId ? 'page' : null },
      img && isSafeHttpUrl(img) ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb', 'aria-hidden': 'true' }),
      h('span', { class: 'meta' }, h('strong', {}, c.fullname), h('small', {}, c.shortname || '')),
      typeof c.progress === 'number' ? h('progress', { max: 100, value: Math.round(c.progress) }) : null));
}

export function renderCourseList({ courses, token, selectedId, folderState }) {
  const groups = groupCourses(courses, S.uncategorised);
  const asFolders = groups.length > 1;
  let searching = false;

  const wantOpen = (g) => {
    if (g.courses.some((c) => c.id === selectedId)) return true;
    const saved = folderState && folderState.get(g.name);
    return saved === undefined ? groups.length <= 3 : saved;
  };

  const entries = groups.map((g) => ({ g, lis: g.courses.map((c) => card(c, token, selectedId)) }));
  const details = [];
  const body = asFolders
    ? h('div', { class: 'folders' }, entries.map(({ g, lis }) => {
      const d = h('details', { class: 'folder', open: wantOpen(g) },
        h('summary', {}, h('span', { class: 'folder-name' }, g.name), h('span', { class: 'count' }, String(g.courses.length))),
        h('ul', { class: 'cards' }, lis));
      d.addEventListener('toggle', () => { if (!searching && folderState) folderState.set(g.name, d.open); });
      details.push(d);
      return d;
    }))
    : h('ul', { class: 'cards' }, entries.flatMap((e) => e.lis));

  const empty = h('p', { class: 'status' }, S.empty);
  empty.hidden = courses.length > 0;
  const search = h('input', {
    type: 'search', class: 'search', placeholder: S.search, 'aria-label': S.search,
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      searching = q !== '';
      let shown = 0;
      entries.forEach(({ g, lis }, i) => {
        let hits = 0;
        for (const li of lis) {
          const hit = !q || li.dataset.text.includes(q);
          li.hidden = !hit;
          if (hit) hits += 1;
        }
        shown += hits;
        if (asFolders) {
          details[i].hidden = hits === 0;
          details[i].open = q ? hits > 0 : wantOpen(g);
        }
      });
      empty.hidden = shown > 0;
    },
  });
  return h('div', { class: 'courses' }, search, empty, body);
}
