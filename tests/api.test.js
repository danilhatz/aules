import test from 'node:test';
import assert from 'node:assert/strict';
import { requestToken, getSiteInfo, getCourses, getCourseContents, MoodleError } from '../src/api.js';
import { describeError } from '../src/errors.js';

const ok = (payload, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => payload };
};

test('requestToken sends credentials in the POST body, encoded, never in the URL', async () => {
  const calls = [];
  const password = 'p&ss=w+d%é ;x';
  const token = await requestToken('10000001', password, { fetchImpl: ok({ token: 'tok123' }, calls) });
  assert.equal(token, 'tok123');
  const { url, opts } = calls[0];
  assert.equal(url, 'https://aules.edu.gva.es/fpa/login/token.php');
  assert.equal(opts.method, 'POST');
  assert.ok(!url.includes('p&ss') && !url.includes('10000001'));
  const body = new URLSearchParams(opts.body.toString());
  assert.equal(body.get('username'), '10000001');
  assert.equal(body.get('password'), password);
  assert.equal(body.get('service'), 'moodle_mobile_app');
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.referrerPolicy, 'no-referrer');
});

test('HTTP 200 with error JSON becomes MoodleError with the Moodle errorcode', async () => {
  const f = ok({ error: 'bad creds', errorcode: 'invalidlogin' });
  await assert.rejects(() => requestToken('u', 'p', { fetchImpl: f }), (e) => e instanceof MoodleError && e.code === 'invalidlogin');
});

test('exception-shaped payloads are errors too', async () => {
  const f = ok({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  await assert.rejects(() => getSiteInfo('t', { fetchImpl: f }), (e) => e.code === 'invalidtoken');
});

test('missing token in a 200 response -> notoken', async () => {
  await assert.rejects(() => requestToken('u', 'p', { fetchImpl: ok({}) }), (e) => e.code === 'notoken');
});

test('network failure -> network; non-JSON body -> badresponse', async () => {
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => getCourses('t', 1, { fetchImpl: down }), (e) => e.code === 'network');
  const html = async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(() => getCourses('t', 1, { fetchImpl: html }), (e) => e.code === 'badresponse');
});

test('web-service calls send wstoken, wsfunction, json format and params', async () => {
  const calls = [];
  const courses = await getCourses('tok', 42, { fetchImpl: ok([{ id: 1 }], calls) });
  assert.deepEqual(courses, [{ id: 1 }]);
  assert.equal(calls[0].url, 'https://aules.edu.gva.es/fpa/webservice/rest/server.php');
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wstoken'), 'tok');
  assert.equal(b.get('wsfunction'), 'core_enrol_get_users_courses');
  assert.equal(b.get('moodlewsrestformat'), 'json');
  assert.equal(b.get('userid'), '42');

  const calls2 = [];
  await getCourseContents('tok', 7, { fetchImpl: ok([], calls2) });
  const b2 = new URLSearchParams(calls2[0].opts.body.toString());
  assert.equal(b2.get('wsfunction'), 'core_course_get_contents');
  assert.equal(b2.get('courseid'), '7');

  const calls3 = [];
  await getSiteInfo('tok', { fetchImpl: ok({ userid: 5 }, calls3) });
  assert.equal(new URLSearchParams(calls3[0].opts.body.toString()).get('wsfunction'), 'core_webservice_get_site_info');
});

test('describeError maps known codes and falls back with the code shown', () => {
  assert.match(describeError(new MoodleError('invalidlogin')), /Wrong user number/);
  assert.match(describeError(new MoodleError('weird_code')), /Something went wrong.*weird_code/);
  assert.match(describeError(new Error('x')), /Something went wrong/);
});
