import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimings } from '../src/timings.js';
import { buildReport } from '../src/diagnostics.js';

function clock(steps) {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)];
}

test('wrap times every API function call and records name, duration and approximate size', async () => {
  const t = createTimings({ now: clock([100, 350, 400, 410]) });
  const api = t.wrap({ getAssignments: async () => ({ courses: ['x'.repeat(2000)] }), getSiteInfo: async () => ({ a: 1 }), constant: 5 });
  assert.equal(api.constant, 5); // non-functions pass through untouched
  await api.getAssignments('tok', 11);
  await api.getSiteInfo('tok');
  const list = t.list();
  assert.deepEqual(list.map((e) => e.name), ['getAssignments', 'getSiteInfo']);
  assert.equal(list[0].ms, 250);
  assert.ok(list[0].bytes > 2000);
  assert.equal(list[1].ms, 10);
  assert.equal(list[0].failed, false);
});

test('failures are timed too and still rethrown unchanged', async () => {
  const t = createTimings({ now: clock([0, 40]) });
  const err = Object.assign(new Error('boom'), { code: 'network' });
  const api = t.wrap({ getCourses: async () => { throw err; } });
  await assert.rejects(() => api.getCourses(), (e) => e === err);
  assert.deepEqual(t.list().map((e) => [e.name, e.ms, e.failed]), [['getCourses', 40, true]]);
});

test('arguments and return values are passed through; memory is bounded; clear empties the list', async () => {
  const t = createTimings({ now: clock([0, 1]), max: 3 });
  const seen = [];
  const api = t.wrap({ f: async (...a) => { seen.push(a); return a.length; } });
  assert.equal(await api.f('t', 1, 2), 3);
  assert.deepEqual(seen, [['t', 1, 2]]);
  for (let i = 0; i < 6; i += 1) await api.f();
  assert.equal(t.list().length, 3);
  t.clear();
  assert.deepEqual(t.list(), []);
});

test('an unserialisable result does not break the call', async () => {
  const t = createTimings({ now: clock([0, 5]) });
  const circular = {}; circular.self = circular;
  const api = t.wrap({ f: async () => circular });
  assert.equal(await api.f(), circular);
  assert.equal(t.list()[0].bytes, 0);
});

test('the diagnostics report lists the slowest calls with only names, times and sizes', () => {
  const timings = [
    { name: 'getSiteInfo', ms: 3100, bytes: 52000, failed: false },
    { name: 'getAssignments', ms: 900, bytes: 8000, failed: false },
    { name: 'getSubmissionStatus', ms: 1500, bytes: 4000, failed: true },
    { name: 'https://evil.example/?token=SECRET', ms: 9999, bytes: 1, failed: false },
    { name: 'getCourses', ms: 'x', bytes: 'y', failed: false },
  ];
  const r = buildReport({ siteInfo: {}, source: 1, courses: [], rawCourse: null, contents: [], errors: {}, timings });
  assert.match(r, /Call timings \(slowest first\)/);
  const lines = r.split('\n');
  const i = lines.findIndex((l) => l.startsWith('Call timings'));
  assert.match(lines[i + 1], /getSiteInfo: 3100 ms, 51 KB/);
  assert.match(lines[i + 2], /getSubmissionStatus: 1500 ms, 4 KB, failed/);
  assert.match(lines[i + 3], /getAssignments: 900 ms, 8 KB/);
  assert.ok(!r.includes('SECRET') && !r.includes('evil'));
  assert.ok(!/getCourses: x/.test(r));
});

test('the report shows "none" when nothing was timed', () => {
  assert.match(buildReport({ siteInfo: {}, timings: [] }), /Call timings \(slowest first\):\n  none/);
  assert.doesNotThrow(() => buildReport({}));
});
