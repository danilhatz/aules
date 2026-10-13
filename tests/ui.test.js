import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections } from './fixtures.js';
import { buildCourse } from '../src/content.js';
import { MoodleError } from '../src/api.js';
import { normalizeCourse } from '../src/courses.js';
import { createMemoryStorage } from '../src/storage.js';

setupDom();
const { renderLogin } = await import('../src/ui/login.js');
const { renderCourseList } = await import('../src/ui/courses.js');
const { renderCourse } = await import('../src/ui/course.js');
const { createFolderState } = await import('../src/folders.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

test('login submits trimmed user + raw password, then clears the password', async () => {
  const seen = [];
  const el = renderLogin({ onSubmit: async (u, p) => { seen.push([u, p]); } });
  document.body.append(el);
  el.querySelector('[name=username]').value = '  10000001 ';
  el.querySelector('[name=password]').value = ' pa ss ';
  el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(seen, [['10000001', ' pa ss ']]);
  assert.equal(el.querySelector('[name=password]').value, '');
  el.remove();
});

test('login shows a friendly message when submit fails and re-enables the button', async () => {
  const el = renderLogin({ onSubmit: async () => { throw new MoodleError('invalidlogin'); } });
  document.body.append(el);
  el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  assert.match(el.querySelector('.form-msg').textContent, /Wrong user number/);
  assert.equal(el.querySelector('button').disabled, false);
  el.remove();
});

test('login tells the user the login is saved on the device', () => {
  const el = renderLogin({ onSubmit: async () => {} });
  assert.match(el.textContent, /saved encrypted on this device/);
});

const norm = (list) => list.map((c) => normalizeCourse(c));

test('flat course list renders cards, token on image, selection and search filter', () => {
  const el = renderCourseList({ courses: norm(sampleCourses), token: 'T', selectedId: 12 });
  const cards = el.querySelectorAll('a.card');
  assert.equal(cards.length, 2);
  assert.equal(el.querySelectorAll('details.folder').length, 0);
  assert.equal(cards[0].getAttribute('href'), '#/course/11');
  assert.match(cards[0].querySelector('img').src, /token=T/);
  assert.equal(cards[0].querySelector('progress').value, 40);
  assert.equal(cards[1].querySelector('img'), null);
  assert.equal(cards[1].getAttribute('aria-current'), 'page');

  const search = el.querySelector('input[type=search]');
  search.value = 'sistemes';
  search.dispatchEvent(new window.Event('input'));
  const items = el.querySelectorAll('li');
  assert.equal(items[0].hidden, true);
  assert.equal(items[1].hidden, false);
  search.value = 'zzz';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(el.querySelector('.status').hidden, false);
});

test('empty course list shows the empty message', () => {
  const el = renderCourseList({ courses: [], token: 'T' });
  assert.equal(el.querySelector('.status').hidden, false);
});

const cats = [
  { id: 1, fullname: 'Gramática A1', shortname: 'G1', category: 'Español A1', progress: 10, image: '' },
  { id: 2, fullname: 'Vocabulario A1', shortname: 'V1', category: 'Español A1', progress: null, image: '' },
  { id: 3, fullname: 'Cultura', shortname: 'C', category: 'Español B1', progress: null, image: '' },
  { id: 4, fullname: 'Suelto', shortname: 'S', category: '', progress: null, image: '' },
];

test('categories render as folders with counts; uncategorised last; names are plain text', () => {
  const evil = [...cats, { id: 5, fullname: '<img src=x onerror=alert(1)>', shortname: '', category: 'Español B1', progress: null, image: '' }];
  const el = renderCourseList({ courses: evil, token: 'T' });
  const folders = [...el.querySelectorAll('details.folder')];
  assert.deepEqual(folders.map((f) => f.querySelector('.folder-name').textContent), ['Español A1', 'Español B1', 'Other courses']);
  assert.deepEqual(folders.map((f) => f.querySelector('.count').textContent), ['2', '2', '1']);
  assert.equal(el.querySelector('img'), null); // the hostile name did not become an element
  assert.ok(el.textContent.includes('<img src=x onerror=alert(1)>'));
});

test('default open: all open for <= 3 folders; selected course opens its folder', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, fullname: `C${i}`, shortname: '', category: `F${i}`, progress: null, image: '' }));
  const few = renderCourseList({ courses: cats, token: 'T' });
  assert.ok([...few.querySelectorAll('details.folder')].every((d) => d.open));
  const lots = renderCourseList({ courses: many, token: 'T', selectedId: 12 });
  const open = [...lots.querySelectorAll('details.folder')].map((d) => d.open);
  assert.deepEqual(open, [false, false, true, false, false]);
});

test('folder toggles persist and are restored on the next render', () => {
  const storage = createMemoryStorage();
  const folderState = createFolderState(storage);
  const el = renderCourseList({ courses: cats, token: 'T', folderState });
  const d = el.querySelector('details.folder');
  d.open = false;
  d.dispatchEvent(new window.Event('toggle'));
  const again = renderCourseList({ courses: cats, token: 'T', folderState: createFolderState(storage) });
  assert.equal(again.querySelector('details.folder').open, false);
});

test('search forces matching folders open, hides others, and restores saved state without overwriting it', async () => {
  const storage = createMemoryStorage();
  const folderState = createFolderState(storage);
  folderState.set('Español A1', false);
  const el = renderCourseList({ courses: cats, token: 'T', folderState });
  const [a1, b1] = el.querySelectorAll('details.folder');
  assert.equal(a1.open, false);
  const search = el.querySelector('input[type=search]');
  search.value = 'gram';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(a1.open, true);
  assert.equal(a1.hidden, false);
  assert.equal(b1.hidden, true);
  a1.dispatchEvent(new window.Event('toggle')); // a toggle during search must not be saved
  search.value = 'Español B1'; // matches by category name too
  search.dispatchEvent(new window.Event('input'));
  assert.equal(b1.hidden, false);
  assert.equal(a1.hidden, true);
  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(a1.open, false);
  assert.equal(a1.hidden, false);
  assert.equal(b1.hidden, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(createFolderState(storage).get('Español A1'), false);
});

test('course view: sections, safe label html, token on file links, first section open', () => {
  const sections = buildCourse(sampleSections, 'T');
  const el = renderCourse({ course: { id: 11, fullname: 'Programació', sections }, token: 'T' });
  assert.equal(el.querySelector('h2').textContent, 'Programació');
  const details = el.querySelectorAll('details');
  assert.equal(details.length, 2);
  assert.equal(details[0].open, true);
  assert.equal(details[1].open, false);
  assert.equal(el.querySelector('script'), null);
  assert.match(el.querySelector('.label').innerHTML, /<strong>course<\/strong>/);
  const link = el.querySelector('a[href*="syllabus.pdf"]');
  assert.match(link.getAttribute('href'), /token=T/);
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.ok(el.textContent.includes('Not available in this app yet'));
  assert.equal(el.querySelector('a.back').getAttribute('href'), '#/');
});

test('course view with no sections and offline banner', () => {
  const el = renderCourse({ course: { id: 1, fullname: 'X', sections: [] }, token: 'T', offline: true });
  assert.ok(el.textContent.includes('This course has no content'));
  assert.ok(el.querySelector('.banner'));
});
