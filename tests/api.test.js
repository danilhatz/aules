import test from 'node:test';
import assert from 'node:assert/strict';
import { requestToken, getSiteInfo, getCourses, getCourseContents, getCoursesByTimeline, getCategories, flatten, getAssignments, getSubmissionStatus, getUnusedDraftItemId, saveSubmission, submitForGrading, deleteDraftFiles, uploadDraftFile, MoodleError } from '../src/api.js';
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

test('getCoursesByTimeline requests all courses without a limit', async () => {
  const calls = [];
  const r = await getCoursesByTimeline('tok', { fetchImpl: ok({ courses: [{ id: 1 }] }, calls) });
  assert.deepEqual(r, { courses: [{ id: 1 }] });
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wsfunction'), 'core_course_get_enrolled_courses_by_timeline_classification');
  assert.equal(b.get('classification'), 'allincludinghidden');
  assert.equal(b.get('limit'), '0');
});

test('getCategories sends the ids criteria as a comma list', async () => {
  const calls = [];
  await getCategories('tok', [3, 5, 8], { fetchImpl: ok([{ id: 3, name: 'A' }], calls) });
  const b = new URLSearchParams(calls[0].opts.body.toString());
  assert.equal(b.get('wsfunction'), 'core_course_get_categories');
  assert.equal(b.get('criteria[0][key]'), 'ids');
  assert.equal(b.get('criteria[0][value]'), '3,5,8');
  assert.equal(b.get('addsubcategories'), '0');
});

const bodyOf = (call) => new URLSearchParams(call.opts.body.toString());

test('flatten builds Moodle bracket keys, including arrays', () => {
  assert.deepEqual(flatten({ a: { b: 1, c: [2, 3] }, d: 'x' }), { 'a[b]': 1, 'a[c][0]': 2, 'a[c][1]': 3, d: 'x' });
  assert.deepEqual(flatten({ plugindata: { onlinetext_editor: { text: '<p>x</p>', format: 1, itemid: 5 }, files_filemanager: 9 } }),
    { 'plugindata[onlinetext_editor][text]': '<p>x</p>', 'plugindata[onlinetext_editor][format]': 1, 'plugindata[onlinetext_editor][itemid]': 5, 'plugindata[files_filemanager]': 9 });
});

test('read calls send the right function and params', async () => {
  const c1 = []; const c2 = []; const c3 = [];
  await getAssignments('t', 7, { fetchImpl: ok({ courses: [] }, c1) });
  await getSubmissionStatus('t', 42, { fetchImpl: ok({}, c2) });
  await getUnusedDraftItemId('t', { fetchImpl: ok({ itemid: 5 }, c3) });
  assert.equal(bodyOf(c1[0]).get('wsfunction'), 'mod_assign_get_assignments');
  assert.equal(bodyOf(c1[0]).get('courseids[0]'), '7');
  assert.equal(bodyOf(c2[0]).get('wsfunction'), 'mod_assign_get_submission_status');
  assert.equal(bodyOf(c2[0]).get('assignid'), '42');
  assert.equal(bodyOf(c3[0]).get('wsfunction'), 'core_files_get_unused_draft_itemid');
});

test('saveSubmission flattens plugindata and treats warnings as errors', async () => {
  const calls = [];
  await saveSubmission('t', 42, { onlinetext_editor: { text: '<p>hi &amp; bye</p>', format: 1, itemid: 5 }, files_filemanager: 9 }, { fetchImpl: ok([], calls) });
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'mod_assign_save_submission');
  assert.equal(b.get('assignmentid'), '42');
  assert.equal(b.get('plugindata[onlinetext_editor][text]'), '<p>hi &amp; bye</p>');
  assert.equal(b.get('plugindata[onlinetext_editor][format]'), '1');
  assert.equal(b.get('plugindata[onlinetext_editor][itemid]'), '5');
  assert.equal(b.get('plugindata[files_filemanager]'), '9');
  await assert.rejects(
    () => saveSubmission('t', 42, {}, { fetchImpl: ok([{ item: 'x', warningcode: 'submissionclosed', message: 'Closed' }]) }),
    (e) => e instanceof MoodleError && e.code === 'submissionclosed' && e.message === 'Closed',
  );
});

test('submitForGrading sends the statement flag and treats warnings as errors', async () => {
  const calls = [];
  await submitForGrading('t', 42, true, { fetchImpl: ok([], calls) });
  assert.equal(bodyOf(calls[0]).get('wsfunction'), 'mod_assign_submit_for_grading');
  assert.equal(bodyOf(calls[0]).get('acceptsubmissionstatement'), '1');
  const c2 = [];
  await submitForGrading('t', 42, false, { fetchImpl: ok([], c2) });
  assert.equal(bodyOf(c2[0]).get('acceptsubmissionstatement'), '0');
  await assert.rejects(() => submitForGrading('t', 42, true, { fetchImpl: ok([{ warningcode: 'nopermission', message: 'No' }]) }), (e) => e.code === 'nopermission');
  await assert.rejects(() => submitForGrading('t', 42, true, { fetchImpl: ok([{}]) }), (e) => e.code === 'warning');
});

test('deleteDraftFiles flattens the files list', async () => {
  const calls = [];
  await deleteDraftFiles('t', 77, [{ filepath: '/', filename: 'a.txt' }], { fetchImpl: ok([], calls) });
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'core_files_delete_draft_files');
  assert.equal(b.get('draftitemid'), '77');
  assert.equal(b.get('files[0][filepath]'), '/');
  assert.equal(b.get('files[0][filename]'), 'a.txt');
});

test('uploadDraftFile posts multipart form data to upload.php and returns the draft itemid', async () => {
  const calls = [];
  const r = await uploadDraftFile('tok', { name: 'photo.jpg', blob: new Blob(['abc'], { type: 'image/jpeg' }) }, { itemid: 12, fetchImpl: ok([{ itemid: 12, filename: 'photo.jpg' }], calls) });
  assert.deepEqual(r, { itemid: 12, filename: 'photo.jpg' });
  assert.equal(calls[0].url, 'https://aules.edu.gva.es/fpa/webservice/upload.php');
  const form = calls[0].opts.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('token'), 'tok');
  assert.equal(form.get('filearea'), 'draft');
  assert.equal(form.get('itemid'), '12');
  assert.equal(form.get('filepath'), '/');
  assert.equal(form.get('file_1').name, 'photo.jpg');
  assert.equal(calls[0].opts.headers, undefined); // the browser must set the multipart boundary itself
  assert.equal(calls[0].opts.credentials, 'omit');
});

test('uploadDraftFile maps error JSON, empty results and network failures', async () => {
  const file = { name: 'a.txt', blob: new Blob(['x']) };
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: ok({ error: 'no', errorcode: 'nopermissions' }) }), (e) => e.code === 'nopermissions');
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: ok([]) }), (e) => e.code === 'badresponse');
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: async () => { throw new TypeError('x'); } }), (e) => e.code === 'network');
});

test('uploadDraftFile turns upload.php per-file errors (duplicate name, too big) into MoodleErrors with its message', async () => {
  const file = { name: 'image.jpg', blob: new Blob(['x']) };
  await assert.rejects(
    () => uploadDraftFile('t', file, { fetchImpl: ok([{ error: 'A file with that name already exists', errortype: 'filenameexist' }]) }),
    (e) => e.code === 'filenameexist' && e.message === 'A file with that name already exists',
  );
  await assert.rejects(() => uploadDraftFile('t', file, { fetchImpl: ok([{ error: 'Too big' }]) }), (e) => e.code === 'uploaderror' && e.message === 'Too big');
});
