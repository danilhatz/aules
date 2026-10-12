import { SITE_URL, SERVICE } from './config.js';

export class MoodleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'MoodleError';
    this.code = code;
  }
}

async function post(url, params, fetchImpl) {
  const f = fetchImpl || globalThis.fetch.bind(globalThis);
  let res;
  try {
    res = await f(url, {
      method: 'POST',
      body: new URLSearchParams(params),
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
