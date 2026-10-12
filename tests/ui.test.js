import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleCourses, sampleSections } from './fixtures.js';
import { buildCourse } from '../src/content.js';
import { MoodleError } from '../src/api.js';

setupDom();
const { renderLogin } = await import('../src/ui/login.js');
const { renderCourseList } = await import('../src/ui/courses.js');
const { renderCourse } = await import('../src/ui/course.js');

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

test('course list renders cards, token on image, selection and search filter', () => {
  const el = renderCourseList({ courses: sampleCourses, token: 'T', selectedId: 12 });
  const cards = el.querySelectorAll('a.card');
  assert.equal(cards.length, 2);
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
