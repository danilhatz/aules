import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, buildReport, runDiagnostics } from '../src/diagnostics.js';
import { MoodleError } from '../src/api.js';

const hostile = {
  siteInfo: {
    release: '4.1.5 (Build: 20230101)', version: '2022112800', sitename: 'SECRET SITE NAME',
    fullname: 'Ana Perez', userid: 4242, username: '10000001', userprivateaccesskey: 'KEY123',
    usermaxuploadfilesize: 52428800, userquota: 104857600, usercanmanageownfiles: true,
    functions: [
      { name: 'mod_assign_save_submission', version: '1' },
      { name: 'core_files_upload', version: '1' },
      { name: 'evil name; <script>' },
      { nope: true },
      null,
    ],
  },
  source: 1,
  courses: [
    { id: 1, fullname: 'Curso Secreto de Ana', shortname: 'CSA', category: 'Español A1' },
    { id: 2, fullname: 'Otro curso', shortname: 'OC', category: 'Español A1' },
    { id: 3, fullname: 'Suelto', shortname: 'S', category: '' },
  ],
  rawCourse: { id: 1, fullname: 'Curso Secreto de Ana', courseimage: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png?token=TOK999', 'weird key https://x.y/token=1': 'v', nested: { list: ['a', 'b', 'c'] } },
  contents: [[
    { id: 1, name: 'Tema privado', modules: [
      { id: 1, modname: 'assign', name: 'Entrega de Ana', contents: [{ filename: 'nota-ana.pdf', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/x.pdf?token=TOK999' }] },
      { id: 2, modname: 'quiz', name: 'Test' },
      { id: 3, modname: 'quiz', name: 'Test 2' },
      { id: 4, modname: 'evil modname <b>', name: 'x' },
    ] },
  ]],
  errors: { core_course_get_contents: 'accessexception', 'weird call https://leak': 'bad code!' },
};

test('shapeOf keeps keys and types only, truncates arrays, redacts data-like keys', () => {
  const s = shapeOf({ a: 'secret', b: 5, c: true, d: null, e: ['x', 'y', 'z'], 'http://leak/1': 'v', f: { g: 'h' } });
  assert.deepEqual(s, { a: '<string>', b: '<number>', c: '<boolean>', d: null, e: ['<string>', '<string>'], '<key>': '<string>', f: { g: '<string>' } });
  assert.equal(shapeOf(undefined), '<unknown>');
});

test('report never contains tokens, names, ids, urls or file names', () => {
  const r = buildReport(hostile);
  for (const secret of ['SECRET SITE NAME', 'Ana', 'Perez', '4242', '10000001', 'KEY123', 'TOK999', 'http', 'nota-ana', 'Curso Secreto', 'Tema privado', 'Entrega', 'CSA', 'evil name', '<script>', 'evil modname', 'weird call', 'weird key', 'leak', 'bad code']) {
    assert.ok(!r.includes(secret), `leaked: ${secret}`);
  }
});

test('report contains the useful facts', () => {
  const r = buildReport(hostile);
  assert.match(r, /Moodle release: 4\.1\.5 \(Build: 20230101\)/);
  assert.match(r, /Category source: 1/);
  assert.match(r, /Español A1: 2 courses/);
  assert.match(r, /Other courses: 1 course\b/);
  assert.match(r, /assign x1/);
  assert.match(r, /quiz x2/);
  assert.match(r, /mod_assign_save_submission: yes/);
  assert.match(r, /mod_quiz_start_attempt: no/);
  assert.match(r, /core_files_upload: yes/);
  assert.match(r, /Web-service functions available \(2\)/);
  assert.match(r, /Max upload size: 52428800/);
  assert.match(r, /core_course_get_contents: accessexception/);
  assert.match(r, /<string>/);
});

test('report copes with an empty/missing data set and a hostile release string', () => {
  const r = buildReport({ siteInfo: { release: 'x'.repeat(200) }, source: null, courses: [], rawCourse: null, contents: [], errors: {} });
  assert.match(r, /Moodle release: <redacted>/);
  assert.match(r, /Enrolled courses: 0/);
  assert.doesNotThrow(() => buildReport({}));
});

const session = { token: 'tok', userid: 7 };
const call = async (fn) => fn(session);

test('runDiagnostics collects data, limits contents to 5 courses and records failures inline', async () => {
  const seen = [];
  const api = {
    getSiteInfo: async () => ({ release: '4.1', functions: [] }),
    getCoursesByTimeline: async () => ({ courses: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, fullname: `C${i}`, coursecategory: 'Cat' })) }),
    getCourseContents: async (token, id) => { seen.push(id); if (id === 2) throw new MoodleError('accessexception'); return [{ id, modules: [] }]; },
  };
  const d = await runDiagnostics({ api, call });
  assert.equal(d.source, 1);
  assert.equal(d.courses.length, 8);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(d.contents.length, 4);
  assert.equal(d.errors.core_course_get_contents, 'accessexception');
  assert.equal(d.rawCourse.id, 1);
});

test('runDiagnostics records a failed site info call and keeps going; invalidtoken aborts', async () => {
  const api = {
    getSiteInfo: async () => { throw new MoodleError('accessexception'); },
    getCoursesByTimeline: async () => ({ courses: [] }),
    getCourses: async () => [],
    getCourseContents: async () => [],
  };
  const d = await runDiagnostics({ api, call });
  assert.equal(d.siteInfo, null);
  assert.equal(d.errors.core_webservice_get_site_info, 'accessexception');
  const bad = { ...api, getSiteInfo: async () => { throw new MoodleError('invalidtoken'); } };
  await assert.rejects(() => runDiagnostics({ api: bad, call }), (e) => e.code === 'invalidtoken');
});

test('runDiagnostics reuses an already loaded course list', async () => {
  let listCalls = 0;
  const api = {
    getSiteInfo: async () => ({}),
    getCoursesByTimeline: async () => { listCalls += 1; return { courses: [] }; },
    getCourses: async () => { listCalls += 1; return []; },
    getCourseContents: async () => [],
  };
  const list = { courses: [{ id: 1, fullname: 'A', category: '' }], source: 3, raw: { id: 1 } };
  const d = await runDiagnostics({ api, call, list });
  assert.equal(listCalls, 0);
  assert.equal(d.source, 3);
});
