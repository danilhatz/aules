import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourse, groupCourses, loadCourseList } from '../src/courses.js';
import { MoodleError } from '../src/api.js';

const S = 'https://aules.edu.gva.es/fpa';

test('normalizeCourse maps a timeline course and rewrites the image URL', () => {
  const c = normalizeCourse({ id: 4, fullname: 'Español A1', shortname: 'ES-A1', coursecategory: ' Español ', progress: 42.5, courseimage: `${S}/pluginfile.php/9/course/overviewfiles/a.png` });
  assert.deepEqual(c, { id: 4, fullname: 'Español A1', shortname: 'ES-A1', progress: 42.5, image: `${S}/webservice/pluginfile.php/9/course/overviewfiles/a.png`, category: 'Español' });
});

test('normalizeCourse maps users_courses data using the category name map and overviewfiles', () => {
  const c = normalizeCourse({ id: 5, fullname: 'X', shortname: 'x', category: 7, progress: null, overviewfiles: [{ fileurl: `${S}/webservice/pluginfile.php/1/a.png` }] }, { 7: 'Cultura' });
  assert.equal(c.category, 'Cultura');
  assert.equal(c.image, `${S}/webservice/pluginfile.php/1/a.png`);
  assert.equal(c.progress, null);
});

test('normalizeCourse drops unsafe or data: images and tolerates missing fields', () => {
  assert.equal(normalizeCourse({ id: 1, courseimage: 'data:image/svg+xml;base64,AAAA' }).image, '');
  assert.equal(normalizeCourse({ id: 1, courseimage: 'javascript:alert(1)' }).image, '');
  const c = normalizeCourse({ id: 2 });
  assert.deepEqual(c, { id: 2, fullname: '', shortname: '', progress: null, image: '', category: '' });
});

test('groupCourses sorts accented names, puts uncategorised last, keeps hostile names as data', () => {
  const g = groupCourses([
    { id: 1, fullname: 'Zeta', category: 'Biología' },
    { id: 2, fullname: 'Alfa', category: 'Álgebra' },
    { id: 3, fullname: 'Beta', category: '' },
    { id: 4, fullname: '<img src=x onerror=alert(1)>', category: 'Biología' },
    { id: 5, fullname: 'Alef', category: 'Biología' },
  ], 'Other courses');
  assert.deepEqual(g.map((x) => x.name), ['Álgebra', 'Biología', 'Other courses']);
  assert.deepEqual(g[1].courses.map((c) => c.id), [4, 5, 1]); // '<' sorts before letters
  assert.equal(g[2].courses[0].id, 3);
});

test('groupCourses: empty -> no groups; single category -> one group', () => {
  assert.deepEqual(groupCourses([], 'Other'), []);
  assert.equal(groupCourses([{ id: 1, fullname: 'a', category: 'A' }], 'Other').length, 1);
});

const timeline = (courses) => async () => ({ courses });

test('source 1: timeline categories win and raw is the first raw course', async () => {
  const api = { getCoursesByTimeline: timeline([{ id: 1, fullname: 'A', coursecategory: 'Cat' }]) };
  const r = await loadCourseList({ api, token: 't', userid: 1 });
  assert.equal(r.source, 1);
  assert.equal(r.courses[0].category, 'Cat');
  assert.equal(r.raw.id, 1);
});

test('falls back to source 2 when the timeline call fails with a Moodle error', async () => {
  const api = {
    getCoursesByTimeline: async () => { throw new MoodleError('accessexception'); },
    getCourses: async () => [{ id: 1, fullname: 'A', category: 7 }, { id: 2, fullname: 'B', category: 8 }],
    getCategories: async (token, ids) => { assert.deepEqual(ids, [7, 8]); return [{ id: 7, name: 'Uno' }, { id: 8, name: 'Dos' }]; },
  };
  const r = await loadCourseList({ api, token: 't', userid: 1 });
  assert.equal(r.source, 2);
  assert.deepEqual(r.courses.map((c) => c.category), ['Uno', 'Dos']);
});

test('falls back when the timeline is empty, not an array, or the function is missing', async () => {
  const base = { getCourses: async () => [{ id: 1, fullname: 'A' }] };
  for (const api of [
    { ...base, getCoursesByTimeline: timeline([]) },
    { ...base, getCoursesByTimeline: async () => ({ courses: 'nope' }) },
    { ...base },
  ]) {
    const r = await loadCourseList({ api, token: 't', userid: 1 });
    assert.equal(r.source, 3);
    assert.equal(r.courses.length, 1);
  }
});

test('falls to source 3 (flat) when category lookup fails or returns nothing', async () => {
  const mk = (getCategories) => ({
    getCoursesByTimeline: async () => { throw new MoodleError('accessexception'); },
    getCourses: async () => [{ id: 1, fullname: 'A', category: 7 }],
    getCategories,
  });
  assert.equal((await loadCourseList({ api: mk(async () => { throw new MoodleError('accessexception'); }), token: 't', userid: 1 })).source, 3);
  assert.equal((await loadCourseList({ api: mk(async () => []), token: 't', userid: 1 })).source, 3);
});

test('invalidtoken and network errors propagate from every stage', async () => {
  const mk = (over) => ({ getCoursesByTimeline: timeline([]), getCourses: async () => [{ id: 1, category: 7 }], getCategories: async () => [], ...over });
  for (const code of ['invalidtoken', 'network']) {
    const err = () => { throw new MoodleError(code); };
    await assert.rejects(() => loadCourseList({ api: mk({ getCoursesByTimeline: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
    await assert.rejects(() => loadCourseList({ api: mk({ getCourses: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
    await assert.rejects(() => loadCourseList({ api: mk({ getCategories: async () => err() }), token: 't', userid: 1 }), (e) => e.code === code);
  }
});

test('a non-array baseline response is a badresponse error', async () => {
  const api = { getCoursesByTimeline: timeline([]), getCourses: async () => null };
  await assert.rejects(() => loadCourseList({ api, token: 't', userid: 1 }), (e) => e.code === 'badresponse');
});
