import test from 'node:test';
import assert from 'node:assert/strict';
import { withToken, buildCourse, toWebserviceUrl } from '../src/content.js';
import { sampleSections } from './fixtures.js';

const F = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php';

test('withToken uses ? or & correctly and only for aules pluginfile URLs', () => {
  assert.equal(withToken(`${F}/1/a.png`, 'T'), `${F}/1/a.png?token=T`);
  assert.equal(withToken(`${F}/1/a.pdf?forcedownload=1`, 'T'), `${F}/1/a.pdf?forcedownload=1&token=T`);
  assert.equal(withToken(`${F}/1/a.pdf?token=old`, 'T'), `${F}/1/a.pdf?token=T`);
});

test('withToken never leaks the token to other hosts or other aules paths', () => {
  assert.equal(withToken('https://evil.example/pluginfile.php/x', 'T'), 'https://evil.example/pluginfile.php/x');
  assert.equal(withToken('https://aules.edu.gva.es.evil.example/fpa/pluginfile.php/x', 'T'), 'https://aules.edu.gva.es.evil.example/fpa/pluginfile.php/x');
  assert.equal(withToken('https://aules.edu.gva.es/fpa/course/view.php?id=1', 'T'), 'https://aules.edu.gva.es/fpa/course/view.php?id=1');
  assert.equal(withToken('not a url', 'T'), 'not a url');
});

test('buildCourse drops hidden modules and empty sections, names blank sections', () => {
  const v = buildCourse(sampleSections, 'T');
  assert.equal(v.length, 2);
  assert.equal(v[0].name, 'General');
  assert.equal(v[1].name, 'Section 1');
  assert.equal(v[1].modules.some((m) => m.name === 'Secret'), false);
});

test('module kinds and links', () => {
  const [general, unit] = buildCourse(sampleSections, 'T');
  const label = general.modules[0];
  assert.equal(label.kind, 'label');
  assert.equal(label.name, '');
  const file = general.modules[1];
  assert.equal(file.kind, 'file');
  assert.equal(file.links[0].label, 'syllabus.pdf');
  assert.equal(file.links[0].href, `${F}/5/mod_resource/content/1/syllabus.pdf?forcedownload=1&token=T`);

  const [url, folder, page, forum] = unit.modules;
  assert.deepEqual(url.links, [{ label: 'Docs site', href: 'https://example.org/docs', external: true }]);
  assert.equal(folder.links.length, 2);
  assert.equal(page.kind, 'page');
  assert.deepEqual(page.links, [{ label: 'Reading', href: `${F}/7/mod_page/content/index.html?token=T` }]);
  assert.equal(forum.kind, 'other');
  assert.equal(forum.unsupported, true);
  assert.deepEqual(forum.links, []);
});

test('javascript: url modules produce no link; missing arrays are tolerated', () => {
  const v = buildCourse([
    { id: 1, section: 0, name: 'S', summary: '', modules: [{ id: 9, name: 'Bad', modname: 'url', contents: [{ type: 'url', fileurl: 'javascript:alert(1)' }] }, { id: 10, name: 'NoContents', modname: 'resource' }] },
    { id: 2, section: 1, name: 'T' },
  ], 'T');
  assert.deepEqual(v[0].modules[0].links, []);
  assert.deepEqual(v[0].modules[1].links, []);
  assert.equal(v.length, 1);
  assert.deepEqual(buildCourse(undefined, 'T'), []);
});

test('sections with only a summary are kept; whitespace/nbsp-only summaries are not', () => {
  const v = buildCourse([
    { id: 1, section: 0, name: 'A', summary: '<p>Real</p>', modules: [] },
    { id: 2, section: 1, name: 'B', summary: '<p>&nbsp; </p>', modules: [] },
  ], 'T');
  assert.deepEqual(v.map((s) => s.name), ['A']);
});

test('token is only added for this Moodle instance\'s webservice pluginfile path', () => {
  assert.equal(withToken('https://aules.edu.gva.es/eso/webservice/pluginfile.php/1/a.png', 'T'), 'https://aules.edu.gva.es/eso/webservice/pluginfile.php/1/a.png');
  assert.equal(withToken('https://aules.edu.gva.es/fpa/pluginfile.php/1/a.png', 'T'), 'https://aules.edu.gva.es/fpa/pluginfile.php/1/a.png');
  assert.equal(withToken('https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png', 'T'), 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/a.png?token=T');
});

test('toWebserviceUrl rewrites only this instance\'s plain pluginfile URLs', () => {
  const S = 'https://aules.edu.gva.es/fpa';
  assert.equal(toWebserviceUrl(`${S}/pluginfile.php/5/course/overviewfiles/a.png`), `${S}/webservice/pluginfile.php/5/course/overviewfiles/a.png`);
  assert.equal(toWebserviceUrl(`${S}/pluginfile.php/5/a.png?x=1`), `${S}/webservice/pluginfile.php/5/a.png?x=1`);
  assert.equal(toWebserviceUrl(`${S}/webservice/pluginfile.php/5/a.png`), `${S}/webservice/pluginfile.php/5/a.png`);
  assert.equal(toWebserviceUrl('https://aules.edu.gva.es/eso/pluginfile.php/5/a.png'), 'https://aules.edu.gva.es/eso/pluginfile.php/5/a.png');
  assert.equal(toWebserviceUrl('https://evil.example/fpa/pluginfile.php/5/a.png'), 'https://evil.example/fpa/pluginfile.php/5/a.png');
  assert.equal(toWebserviceUrl('not a url'), 'not a url');
});

test('modules carry modname; only forum is marked soon; other unsupported types are not', () => {
  const [, unit] = buildCourse(sampleSections, 'T');
  const byName = Object.fromEntries(unit.modules.map((m) => [m.name, m]));
  assert.equal(byName.Questions.modname, 'forum');
  assert.equal(byName.Questions.soon, true);
  assert.equal(byName.Glossary.unsupported, true);
  assert.equal(byName.Glossary.soon, undefined);
  assert.equal(byName.Reading.modname, 'page');
  const v = buildCourse([{ id: 1, section: 0, name: 'S', summary: '', modules: [
    { id: 1, name: 'HW', modname: 'assign' }, { id: 2, name: 'Q', modname: 'quiz' }, { id: 3, name: 'X' },
  ] }], 'T');
  assert.deepEqual(v[0].modules.map((m) => [m.modname, Boolean(m.soon)]), [['assign', false], ['quiz', false], ['', false]]);
});

test('sections carry their Moodle section number', () => {
  const v = buildCourse(sampleSections, 'T');
  assert.deepEqual(v.map((s) => s.number), [0, 1]);
  const w = buildCourse([{ id: 1, name: 'A', summary: '<p>x</p>' }], 'T');
  assert.equal(w[0].number, 0);
});

test('assign modules become their own kind and are not coming soon', () => {
  const [, unit] = buildCourse(sampleSections, 'T');
  const tarea = unit.modules.find((m) => m.name === 'Tarea 1');
  assert.equal(tarea.kind, 'assign');
  assert.equal(tarea.unsupported, undefined);
  assert.equal(tarea.soon, undefined);
  assert.deepEqual(tarea.links, []);
});

test('quiz modules become their own kind and are not coming soon', () => {
  const [, unit] = buildCourse(sampleSections, 'T');
  const t = unit.modules.find((m) => m.name === 'Test 1');
  assert.equal(t.kind, 'quiz');
  assert.equal(t.unsupported, undefined);
  assert.equal(t.soon, undefined);
  assert.deepEqual(t.links, []);
});
