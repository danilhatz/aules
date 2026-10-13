import { loadCourseList } from './courses.js';

const SAFE_TEXT = /^[\w .():+-]{1,60}$/;
const SAFE_FN = /^[a-z][a-z0-9_]{2,80}$/;
const SAFE_MOD = /^[a-z][a-z_]{1,30}$/;
const SAFE_CODE = /^[a-z][a-z_]{1,60}$/;
const SAFE_CALL = /^[a-z][a-z0-9_]{2,80}$/;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const SAFE_TIMING_NAME = /^[A-Za-z][A-Za-z0-9]{2,40}$/;

const CHECKS = [
  'core_course_get_enrolled_courses_by_timeline_classification', 'core_course_get_categories',
  'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'mod_assign_save_submission', 'mod_assign_submit_for_grading', 'core_files_upload',
  'mod_quiz_get_quizzes_by_courses', 'mod_quiz_start_attempt', 'mod_quiz_get_attempt_data', 'mod_quiz_process_attempt',
  'mod_forum_get_forums_by_courses', 'mod_forum_get_forum_discussions', 'mod_forum_get_discussion_posts', 'mod_forum_add_discussion', 'mod_forum_add_discussion_post',
];

export function shapeOf(v, depth = 0) {
  if (v === null) return null;
  if (Array.isArray(v)) return depth > 5 ? '<array>' : v.slice(0, 2).map((x) => shapeOf(x, depth + 1));
  switch (typeof v) {
    case 'string': return '<string>';
    case 'number': return '<number>';
    case 'boolean': return '<boolean>';
    case 'object':
      if (depth > 5) return '<object>';
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [SAFE_KEY.test(k) ? k : '<key>', shapeOf(x, depth + 1)]));
    default: return '<unknown>';
  }
}

const safeText = (v) => (typeof v === 'string' && SAFE_TEXT.test(v) ? v : '<redacted>');
const num = (v) => (Number.isFinite(v) ? String(v) : 'unknown');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function buildReport(d) {
  const info = d.siteInfo || {};
  const courses = Array.isArray(d.courses) ? d.courses : [];
  const fns = new Set((Array.isArray(info.functions) ? info.functions : [])
    .map((f) => f && f.name).filter((n) => typeof n === 'string' && SAFE_FN.test(n)));

  const cats = new Map();
  for (const c of courses) {
    const name = c.category ? String(c.category).slice(0, 80) : 'Other courses';
    cats.set(name, (cats.get(name) || 0) + 1);
  }
  const mods = new Map();
  for (const sections of Array.isArray(d.contents) ? d.contents : []) {
    for (const s of Array.isArray(sections) ? sections : []) {
      for (const m of Array.isArray(s && s.modules) ? s.modules : []) {
        const n = m && typeof m.modname === 'string' && SAFE_MOD.test(m.modname) ? m.modname : null;
        if (n) mods.set(n, (mods.get(n) || 0) + 1);
      }
    }
  }
  const errors = Object.entries(d.errors || {})
    .filter(([k]) => SAFE_CALL.test(k))
    .map(([k, v]) => `${k}: ${typeof v === 'string' && SAFE_CODE.test(v) ? v : 'error'}`);

  // Only the API function name, milliseconds and size are ever printed (no URLs, tokens or data).
  const timingLines = (Array.isArray(d.timings) ? d.timings : [])
    .filter((t) => t && SAFE_TIMING_NAME.test(t.name) && Number.isFinite(t.ms) && Number.isFinite(t.bytes))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 12)
    .map((t) => `  ${t.name}: ${t.ms} ms, ${Math.round(t.bytes / 1024)} KB${t.failed ? ', failed' : ''}`);

  const lines = [
    'Aules diagnostics',
    `Moodle release: ${safeText(info.release)}`,
    `Moodle version: ${safeText(info.version)}`,
    `Max upload size: ${num(info.usermaxuploadfilesize)}`,
    `User quota: ${num(info.userquota)}`,
    `Can manage own files: ${info.usercanmanageownfiles === true ? 'yes' : info.usercanmanageownfiles === false ? 'no' : 'unknown'}`,
    `Category source: ${d.source ?? 'unknown'}`,
    `Enrolled courses: ${courses.length}`,
    'Categories:',
    ...[...cats.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([n, c]) => `  ${n}: ${plural(c, 'course', 'courses')}`),
    `Activity types (first ${Math.min(courses.length, 5)} courses):`,
    ...[...mods.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `  ${n} x${c}`),
    'Key functions the token may call:',
    ...CHECKS.map((n) => `  ${n}: ${fns.has(n) ? 'yes' : 'no'}`),
    `Web-service functions available (${fns.size}):`,
    [...fns].sort().join(', ') || '  none reported',
    'Call timings (slowest first):',
    ...(timingLines.length ? timingLines : ['  none']),
    'Call errors:',
    ...(errors.length ? errors.map((e) => `  ${e}`) : ['  none']),
    'Data shapes (keys and types only):',
    JSON.stringify({
      course_overview: shapeOf(d.rawCourse ?? null),
      contents_first_course: shapeOf(Array.isArray(d.contents) && d.contents[0] ? d.contents[0] : null),
    }, null, 1),
  ];
  return lines.join('\n');
}

export async function runDiagnostics({ api, call, list }) {
  const errors = {};
  const guard = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e && e.code === 'invalidtoken') throw e;
      errors[name] = (e && e.code) || 'error';
      return null;
    }
  };
  const siteInfo = await guard('core_webservice_get_site_info', () => call((s) => api.getSiteInfo(s.token)));
  const loaded = list || await guard('course_list', () => call((s) => loadCourseList({ api, token: s.token, userid: s.userid })));
  const courses = (loaded && loaded.courses) || [];
  const contents = [];
  for (const c of courses.slice(0, 5)) {
    const r = await guard('core_course_get_contents', () => call((s) => api.getCourseContents(s.token, c.id)));
    if (r) contents.push(r);
  }
  return { siteInfo, source: loaded ? loaded.source : null, courses, rawCourse: loaded ? loaded.raw : null, contents, errors };
}
