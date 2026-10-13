import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sampleForums, sampleDiscussions, samplePosts } from './fixtures.js';
import { MoodleError } from '../src/api.js';

setupDom();
const { renderForum, renderTopic } = await import('../src/ui/forum.js');
const { parseForums, parseDiscussions, parsePosts } = await import('../src/forum.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const forum = parseForums(sampleForums)[0];
const topics = parseDiscussions(sampleDiscussions);
const posts = parsePosts(samplePosts);

const forumProps = (over = {}) => ({
  courseId: 11, cmid: 7, forum, topics, hasMore: false, fresh: true, offline: false, locale: 'en', token: 'T',
  actions: { loadMore: async () => ({ topics: [], hasMore: false }) }, ...over,
});

function topicProps(over = {}) {
  const drafts = new Map();
  return {
    props: {
      courseId: 11, cmid: 7, title: 'Verb tenses', posts, discussion: topics[0], fresh: true, offline: false, locale: 'en', token: 'T', flash: '',
      draftOf: (id) => drafts.get(id) || '', onDraft: (id, t) => drafts.set(id, t),
      actions: { send: async () => {} },
      onDone: () => {}, ...over,
    },
    drafts,
  };
}
const byText = (el, text) => [...el.querySelectorAll('button')].filter((b) => b.textContent === text);

test('topic list shows title, author, replies and badges, linking to each topic', () => {
  const el = renderForum(forumProps());
  assert.equal(el.querySelector('h2').textContent, 'Questions');
  assert.match(el.querySelector('.intro').textContent, /Ask your questions/);
  const rows = el.querySelectorAll('ul.topics > li');
  assert.equal(rows.length, 2);
  const a = rows[0].querySelector('a');
  assert.equal(a.getAttribute('href'), '#/course/11/forum/7/topic/101');
  assert.equal(a.textContent, 'Verb tenses');
  assert.match(rows[0].textContent, /Ana Soler/);
  assert.match(rows[0].textContent, /Replies: 2/);
  assert.match(rows[0].textContent, /Pinned/);
  assert.doesNotMatch(rows[1].textContent, /Pinned/);
});

test('an empty forum says so; no "undefined" or "null" text', () => {
  const el = renderForum(forumProps({ topics: [], forum: { name: 'F', introHtml: '' } }));
  assert.equal(el.querySelector('p.note:not([hidden])').textContent, 'No topics yet');
  assert.doesNotMatch(el.textContent, /undefined|null/);
});

test('Load more appears only with fresh data and a full page, appends topics and hides when done', async () => {
  const more = [{ id: 103, title: 'Third', author: 'Z', modified: 1, replies: 0, pinned: false, locked: false, canReply: true }];
  let calls = 0;
  const el = renderForum(forumProps({ hasMore: true, actions: { loadMore: async () => { calls += 1; return { topics: more, hasMore: false }; } } }));
  assert.equal(byText(el, 'Load more').length, 1);
  assert.equal(byText(renderForum(forumProps({ hasMore: true, fresh: false })), 'Load more').length, 0);
  assert.equal(byText(renderForum(forumProps({ hasMore: true, offline: true })), 'Load more').length, 0);
  byText(el, 'Load more')[0].click();
  await tick();
  assert.equal(calls, 1);
  assert.equal(el.querySelectorAll('ul.topics > li').length, 3);
  assert.equal(byText(el, 'Load more')[0].hidden, true);
});

test('Load more failure shows the error and can be retried', async () => {
  const el = renderForum(forumProps({ hasMore: true, actions: { loadMore: async () => { throw new MoodleError('network'); } } }));
  const btn = byText(el, 'Load more')[0];
  btn.click();
  await tick();
  assert.match(el.querySelector('.form-msg').textContent, /Cannot reach Aules/);
  assert.equal(btn.disabled, false);
});

test('thread: posts in order with indentation classes, safe HTML, attachment link with token', () => {
  const { props } = topicProps();
  const el = renderTopic(props);
  const items = [...el.querySelectorAll('.post')];
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((x) => x.getAttribute('data-id')), ['501', '503', '504']);
  assert.ok(items[1].classList.contains('depth-1'));
  assert.ok(items[2].classList.contains('depth-2'));
  assert.equal(el.querySelector('script'), null);
  assert.doesNotMatch(el.innerHTML, /alert\(1\)/);
  const att = items[0].querySelector('a[href*="notes.pdf"]');
  assert.match(att.getAttribute('href'), /token=T/);
  assert.equal(att.getAttribute('rel'), 'noopener noreferrer');
  assert.match(items[0].textContent, /Ana Soler/);
});

test('Reply buttons only on posts the user can reply to, and only with fresh online data', () => {
  assert.equal(byText(renderTopic(topicProps().props), 'Reply').length, 2); // 501 and 503; 504 has no capability
  assert.equal(byText(renderTopic(topicProps({ fresh: false }).props), 'Reply').length, 0);
  assert.equal(byText(renderTopic(topicProps({ offline: true }).props), 'Reply').length, 0);
  assert.equal(byText(renderTopic(topicProps({ discussion: { ...topics[0], locked: true } }).props), 'Reply').length, 0);
  assert.match(renderTopic(topicProps({ offline: true }).props).textContent, /You are offline/);
});

test('a removed post shows a note instead of text, without crashing on missing fields', () => {
  const odd = [{ id: 1, parentId: 0, subject: '', messageHtml: '', author: '', created: 0, deleted: true, canReply: true, attachments: [] },
    { id: 2, parentId: 0, subject: '', messageHtml: '', author: '', created: 1, deleted: false, canReply: false, attachments: [] }];
  const el = renderTopic(topicProps({ posts: odd }).props);
  assert.match(el.querySelector('.post[data-id="1"]').textContent, /This post was removed/);
  assert.doesNotMatch(el.textContent, /undefined|null/);
  assert.equal(byText(el, 'Reply').length, 0);
});

test('deep replies name the person they answer', () => {
  const chain = [1, 2, 3, 4, 5].map((n) => ({ id: n, parentId: n - 1, subject: '', messageHtml: `<p>m${n}</p>`, author: `A${n}`, created: n, deleted: false, canReply: false, attachments: [] }));
  const el = renderTopic(topicProps({ posts: chain }).props);
  assert.match(el.querySelector('.post[data-id="5"]').textContent, /In reply to A4/);
  assert.doesNotMatch(el.querySelector('.post[data-id="4"]').textContent, /In reply to/);
});

test('flash banners', () => {
  assert.match(renderTopic(topicProps({ flash: 'sent' }).props).querySelector('.flash').textContent, /Reply sent/);
  assert.match(renderTopic(topicProps({ flash: 'unknown' }).props).querySelector('.flash').textContent, /Could not confirm/);
  assert.equal(renderTopic(topicProps().props).querySelector('.flash'), null);
});

test('typing stores a draft and a saved draft is restored into the box', () => {
  const { props, drafts } = topicProps({ draftOf: (id) => (id === 501 ? 'half written' : '') });
  const el = renderTopic(props);
  const box = el.querySelector('.post[data-id="501"] textarea');
  assert.equal(box.value, 'half written');
  box.value = 'more';
  box.dispatchEvent(new window.Event('input'));
  assert.equal(drafts.get(501), 'more');
});

test('Send never sends by itself: it opens the confirm; empty text is refused', () => {
  const sent = [];
  const { props } = topicProps({ actions: { send: async (p, t) => { sent.push([p.id, t]); } } });
  const el = renderTopic(props);
  const post = el.querySelector('.post[data-id="501"]');
  post.querySelector('.reply-btn').click();
  assert.equal(post.querySelector('.reply-box').hidden, false);
  byText(post, 'Send')[0].click();
  assert.match(post.querySelector('.form-msg').textContent, /Write a reply first/);
  assert.equal(post.querySelector('.confirm').hidden, true);
  post.querySelector('textarea').value = 'Hola';
  byText(post, 'Send')[0].click();
  assert.equal(post.querySelector('.confirm').hidden, false);
  assert.match(post.querySelector('.confirm').textContent, /Send your reply now\?/);
  assert.deepEqual(sent, []);
  byText(post, 'Cancel')[0].click();
  assert.equal(post.querySelector('.confirm').hidden, true);
  assert.deepEqual(sent, []);
});

test('Yes, send sends once with the typed text, locks everything while busy, and reports sent', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const sentRef = [];
  const done = [];
  const { props } = topicProps({
    actions: { send: async (p, t) => { sentRef.push([p.id, t]); await gate; } },
    onDone: (k) => done.push(k),
  });
  const el = renderTopic(props);
  const post = el.querySelector('.post[data-id="501"]');
  post.querySelector('.reply-btn').click();
  post.querySelector('textarea').value = 'Hola';
  byText(post, 'Send')[0].click();
  const yes = byText(post, 'Yes, send')[0];
  yes.click();
  yes.click(); // a second tap while pending must not send again
  await tick();
  assert.deepEqual(sentRef, [[501, 'Hola']]);
  assert.equal(post.querySelector('textarea').disabled, true);
  assert.equal(yes.disabled, true);
  assert.equal(el.querySelector('.post[data-id="503"] textarea').disabled, true); // every reply box locks
  release();
  await tick();
  assert.deepEqual(done, ['sent']);
});

test('a refused reply shows the message and unlocks so the student can fix it; the text stays', async () => {
  const { props } = topicProps({ actions: { send: async () => { throw new MoodleError('nopermission', 'You cannot reply here'); } } });
  const el = renderTopic(props);
  const post = el.querySelector('.post[data-id="501"]');
  post.querySelector('.reply-btn').click();
  post.querySelector('textarea').value = 'Hola';
  byText(post, 'Send')[0].click();
  byText(post, 'Yes, send')[0].click();
  await tick();
  assert.match(post.querySelector('.form-msg').textContent, /You cannot reply here/);
  assert.equal(post.querySelector('textarea').disabled, false);
  assert.equal(post.querySelector('textarea').value, 'Hola');
});

test('unconfirmed outcome is handed to the app (it reloads); signedout is silent', async () => {
  const done = [];
  const unconfirmed = topicProps({ actions: { send: async () => { throw new MoodleError('unconfirmed'); } }, onDone: (k) => done.push(k) });
  const el = renderTopic(unconfirmed.props);
  const post = el.querySelector('.post[data-id="501"]');
  post.querySelector('textarea').value = 'Hola';
  byText(post, 'Send')[0].click();
  byText(post, 'Yes, send')[0].click();
  await tick();
  assert.deepEqual(done, ['unknown']);

  const quiet = topicProps({ actions: { send: async () => { throw new MoodleError('signedout'); } }, onDone: (k) => done.push(k) });
  const el2 = renderTopic(quiet.props);
  const post2 = el2.querySelector('.post[data-id="501"]');
  post2.querySelector('textarea').value = 'Hola';
  byText(post2, 'Send')[0].click();
  byText(post2, 'Yes, send')[0].click();
  await tick();
  assert.deepEqual(done, ['unknown']);
  assert.equal(post2.querySelector('.form-msg').textContent, '');
});

test('Final review: a plain pluginfile attachment URL is rewritten to the webservice path with the token; unsafe URLs are not linked', () => {
  const att = [
    { name: 'plain.pdf', url: 'https://aules.edu.gva.es/fpa/pluginfile.php/9/mod_forum/attachment/1/plain.pdf' },
    { name: 'evil', url: 'javascript:alert(1)' },
  ];
  const el = renderTopic(topicProps({ posts: [{ id: 1, parentId: 0, subject: '', messageHtml: '<p>x</p>', author: 'A', created: 1, deleted: false, canReply: false, attachments: att }] }).props);
  const links = [...el.querySelectorAll('.post ul.links a')];
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/9/mod_forum/attachment/1/plain.pdf?token=T');
  assert.doesNotMatch(el.innerHTML, /javascript:/);
});
