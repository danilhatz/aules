import { MoodleError } from './api.js';
import { toWebserviceUrl } from './content.js';
import { isSafeHttpUrl } from './sanitize.js';

const FATAL = new Set(['invalidtoken', 'network']);
const isFatal = (e) => Boolean(e && FATAL.has(e.code));

function pickImage(c) {
  const first = c.overviewfiles && c.overviewfiles[0] && c.overviewfiles[0].fileurl;
  for (const cand of [c.courseimage, first]) {
    if (typeof cand !== 'string') continue;
    const url = toWebserviceUrl(cand);
    if (isSafeHttpUrl(url)) return url;
  }
  return '';
}

export function normalizeCourse(c, names = {}) {
  return {
    id: c.id,
    fullname: c.fullname || '',
    shortname: c.shortname || '',
    progress: typeof c.progress === 'number' ? c.progress : null,
    image: pickImage(c),
    category: String(c.coursecategory || names[c.category] || '').trim(),
  };
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.fullname, b.fullname);

export function groupCourses(courses, uncategorisedName) {
  const by = new Map();
  for (const c of courses) {
    const key = c.category || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  const groups = [...by.entries()]
    .filter(([name]) => name)
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([name, list]) => ({ name, courses: [...list].sort(byName) }));
  if (by.has('')) groups.push({ name: uncategorisedName, courses: [...by.get('')].sort(byName) });
  return groups;
}

// Source 1: timeline overview (has category names). Source 2: enrolled courses + category lookup.
// Source 3: enrolled courses, flat. Only auth/network failures abort; anything else falls through.
export async function loadCourseList({ api, token, userid }) {
  try {
    const r = await api.getCoursesByTimeline(token);
    const raw = r && Array.isArray(r.courses) ? r.courses : [];
    if (raw.length) return { courses: raw.map((c) => normalizeCourse(c)), source: 1, raw: raw[0] };
  } catch (e) {
    if (isFatal(e)) throw e;
  }
  const raw = await api.getCourses(token, userid);
  if (!Array.isArray(raw)) throw new MoodleError('badresponse');
  const ids = [...new Set(raw.map((c) => c.category).filter((id) => id != null))];
  if (ids.length) {
    try {
      const cats = await api.getCategories(token, ids);
      const names = Object.fromEntries((Array.isArray(cats) ? cats : []).map((k) => [k.id, k.name]));
      if (Object.keys(names).length) {
        return { courses: raw.map((c) => normalizeCourse(c, names)), source: 2, raw: raw[0] || null };
      }
    } catch (e) {
      if (isFatal(e)) throw e;
    }
  }
  return { courses: raw.map((c) => normalizeCourse(c)), source: 3, raw: raw[0] || null };
}
