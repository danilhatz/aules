import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleForums, sampleDiscussions, samplePosts } from './fixtures.js';
import { MoodleError } from '../src/api.js';
import { parseForums, parseDiscussions, parsePosts, buildThread, MAX_DEPTH, replySubject, replyHtml, canReply } from '../src/forum.js';

const post = (id, parentId, created, extra = {}) => ({ id, parentId, subject: '', messageHtml: '', author: `A${id}`, created, deleted: false, canReply: true, attachments: [], ...extra });

test('parseForums keeps well-formed forums and rejects a non-array', () => {
  assert.deepEqual(parseForums(sampleForums)[0], { id: 31, cmid: 7, name: 'Questions', introHtml: '<p>Ask your questions here.</p>', type: 'general' });
  assert.equal(parseForums([{ id: 'x', cmid: 3 }, null, { id: 5, cmid: 6 }]).length, 1);
  assert.throws(() => parseForums({}), (e) => e instanceof MoodleError && e.code === 'badresponse');
  assert.throws(() => parseForums(null), (e) => e.code === 'badresponse');
});

test('parseDiscussions maps the Moodle fields and tolerates missing ones', () => {
  const t = parseDiscussions(sampleDiscussions);
  assert.deepEqual(t[0], { id: 101, title: 'Verb tenses', author: 'Ana Soler', modified: 1784900000, replies: 2, pinned: true, locked: false, canReply: true });
  const sparse = parseDiscussions({ discussions: [{ discussion: 7 }, { id: 1 }, null] });
  assert.equal(sparse.length, 1);
  assert.deepEqual(sparse[0], { id: 7, title: '', author: '', modified: 0, replies: 0, pinned: false, locked: false, canReply: true });
  assert.equal(parseDiscussions({ discussions: [{ discussion: 8, canreply: false }] })[0].canReply, false);
  assert.throws(() => parseDiscussions({}), (e) => e.code === 'badresponse');
  assert.throws(() => parseDiscussions(null), (e) => e.code === 'badresponse');
});

test('parsePosts maps posts, capabilities and attachments, and never yields undefined text', () => {
  const p = parsePosts(samplePosts);
  assert.equal(p.length, 3);
  assert.equal(p[0].canReply, true);
  assert.equal(p[2].canReply, false);
  assert.equal(p[0].attachments[0].name, 'notes.pdf');
  assert.equal(p[1].parentId, 501);
  const sparse = parsePosts({ posts: [{ id: 9 }, { id: 10, isdeleted: true, author: null, message: null, capabilities: null, attachments: [{ filename: '', fileurl: 'x' }] }, { nope: 1 }] });
  assert.equal(sparse.length, 2);
  assert.deepEqual(sparse[0], { id: 9, parentId: 0, subject: '', messageHtml: '', author: '', created: 0, deleted: false, canReply: false, attachments: [] });
  assert.equal(sparse[1].deleted, true);
  assert.equal(sparse[1].author, '');
  assert.deepEqual(sparse[1].attachments, []);
  assert.throws(() => parsePosts({}), (e) => e.code === 'badresponse');
});

test('buildThread orders replies under their parent, oldest first', () => {
  const posts = [post(1, 0, 10), post(3, 1, 30), post(2, 1, 20), post(4, 2, 25), post(5, 0, 40)];
  const t = buildThread(posts);
  assert.deepEqual(t.map((x) => x.post.id), [1, 2, 4, 3, 5]);
  assert.deepEqual(t.map((x) => x.depth), [0, 1, 2, 1, 0]);
  assert.ok(t.every((x) => x.replyTo === ''));
});

test('buildThread clamps depth at 3 and names the parent author for deeper replies', () => {
  const chain = [post(1, 0, 1), post(2, 1, 2), post(3, 2, 3), post(4, 3, 4), post(5, 4, 5)];
  const t = buildThread(chain);
  assert.equal(MAX_DEPTH, 3);
  assert.deepEqual(t.map((x) => x.depth), [0, 1, 2, 3, 3]);
  assert.equal(t[3].replyTo, '');
  assert.equal(t[4].replyTo, 'A4');
});

test('buildThread shows every post exactly once for orphans, self-parents and cycles, and handles long chains', () => {
  const odd = [post(1, 99, 5), post(2, 2, 6), post(3, 4, 7), post(4, 3, 8)];
  const t = buildThread(odd);
  assert.deepEqual(t.map((x) => x.post.id).sort(), [1, 2, 3, 4]);
  const long = Array.from({ length: 5000 }, (_, i) => post(i + 1, i, i + 1));
  const lt = buildThread(long);
  assert.equal(lt.length, 5000);
  assert.equal(lt[4999].depth, 3);
  assert.deepEqual(buildThread([]), []);
});

test('replySubject adds "Re: " once', () => {
  assert.equal(replySubject('Verb tenses'), 'Re: Verb tenses');
  assert.equal(replySubject('Re: Verb tenses'), 'Re: Verb tenses');
  assert.equal(replySubject('  RE: x '), 'RE: x');
  assert.equal(replySubject(''), 'Re:');
  assert.equal(replySubject(undefined), 'Re:');
});

test('replyHtml escapes everything the student types and wraps lines in paragraphs', () => {
  assert.equal(replyHtml('Hola'), '<p>Hola</p>');
  assert.equal(replyHtml('Hola\r\n\r\n  adiós  \n'), '<p>Hola</p><p>adiós</p>');
  assert.equal(replyHtml('<script>alert("x")</script> & \'q\''), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
  assert.equal(replyHtml('   \n  '), '');
  assert.equal(replyHtml(null), '');
});

test('canReply needs the post capability, a live post and an open topic', () => {
  const p = post(1, 0, 1);
  assert.equal(canReply(p), true);
  assert.equal(canReply({ ...p, canReply: false }), false);
  assert.equal(canReply({ ...p, deleted: true }), false);
  assert.equal(canReply(p, { locked: true, canReply: true }), false);
  assert.equal(canReply(p, { locked: false, canReply: false }), false);
  assert.equal(canReply(p, { locked: false, canReply: true }), true);
  assert.equal(canReply(p, null), true);
});
