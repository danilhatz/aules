import { SITE_URL, SERVICE } from './config.js';

export class MoodleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'MoodleError';
    this.code = code;
  }
}

async function send(url, body, fetchImpl) {
  const f = fetchImpl || globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await f(url, {
      method: 'POST',
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new MoodleError('network');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new MoodleError('badresponse');
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && (data.error || data.exception || data.errorcode)) {
    throw new MoodleError(data.errorcode || data.exception || 'unknown', data.error || data.message);
  }
  return data;
}

const post = (url, params, fetchImpl) => send(url, new URLSearchParams(params), fetchImpl);

export async function requestToken(username, password, { fetchImpl } = {}) {
  const data = await post(`${SITE_URL}/login/token.php`, { username, password, service: SERVICE }, fetchImpl);
  if (!data || !data.token) throw new MoodleError('notoken');
  return data.token;
}

function ws(token, wsfunction, params, fetchImpl) {
  return post(
    `${SITE_URL}/webservice/rest/server.php`,
    { wstoken: token, wsfunction, moodlewsrestformat: 'json', ...params },
    fetchImpl,
  );
}

export const getSiteInfo = (token, { fetchImpl } = {}) =>
  ws(token, 'core_webservice_get_site_info', {}, fetchImpl);

export const getCourses = (token, userid, { fetchImpl } = {}) =>
  ws(token, 'core_enrol_get_users_courses', { userid }, fetchImpl);

export const getCourseContents = (token, courseId, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_contents', { courseid: courseId }, fetchImpl);

export const getCoursesByTimeline = (token, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_enrolled_courses_by_timeline_classification', { classification: 'allincludinghidden', limit: 0 }, fetchImpl);

export const getCategories = (token, ids, { fetchImpl } = {}) =>
  ws(token, 'core_course_get_categories', { 'criteria[0][key]': 'ids', 'criteria[0][value]': ids.join(','), addsubcategories: 0 }, fetchImpl);

export function flatten(value, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

export const getAssignments = (token, courseId, { fetchImpl } = {}) =>
  ws(token, 'mod_assign_get_assignments', { 'courseids[0]': courseId }, fetchImpl);

export const getSubmissionStatus = (token, assignId, { fetchImpl } = {}) =>
  ws(token, 'mod_assign_get_submission_status', { assignid: assignId }, fetchImpl);

export const getUnusedDraftItemId = (token, { fetchImpl } = {}) =>
  ws(token, 'core_files_get_unused_draft_itemid', {}, fetchImpl);

function throwOnWarnings(result) {
  if (Array.isArray(result) && result.length) {
    const w = result[0] || {};
    throw new MoodleError(w.warningcode || 'warning', w.message || w.warningcode || 'warning');
  }
  return result;
}

export const saveSubmission = async (token, assignmentId, plugindata, { fetchImpl } = {}) =>
  throwOnWarnings(await ws(token, 'mod_assign_save_submission', { assignmentid: assignmentId, ...flatten({ plugindata }) }, fetchImpl));

export const submitForGrading = async (token, assignmentId, acceptStatement, { fetchImpl } = {}) =>
  throwOnWarnings(await ws(token, 'mod_assign_submit_for_grading', { assignmentid: assignmentId, acceptsubmissionstatement: acceptStatement ? 1 : 0 }, fetchImpl));

export const deleteDraftFiles = (token, itemId, files, { fetchImpl } = {}) =>
  ws(token, 'core_files_delete_draft_files', { draftitemid: itemId, ...flatten({ files }) }, fetchImpl);

export async function uploadDraftFile(token, file, { itemid = 0, fetchImpl } = {}) {
  const form = new FormData();
  form.append('token', token);
  form.append('filearea', 'draft');
  form.append('itemid', String(itemid));
  form.append('filepath', '/');
  form.append('file_1', file.blob, file.name);
  const data = await send(`${SITE_URL}/webservice/upload.php`, form, fetchImpl);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || first.itemid == null) throw new MoodleError('badresponse');
  return { itemid: first.itemid, filename: first.filename };
}
