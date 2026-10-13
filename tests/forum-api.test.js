import test from 'node:test';
import assert from 'node:assert/strict';
import { getForums, getForumDiscussions, getDiscussionPosts, addDiscussionPost, MoodleError } from '../src/api.js';

const ok = (payload, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => payload };
};
const bodyOf = (c) => new URLSearchParams(c.opts.body.toString());

test('getForums asks for the forums of one course', async () => {
  const calls = [];
  const r = await getForums('t', 11, { fetchImpl: ok([{ id: 1 }], calls) });
  assert.deepEqual(r, [{ id: 1 }]);
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'mod_forum_get_forums_by_courses');
  assert.equal(b.get('courseids[0]'), '11');
  assert.equal(b.get('wstoken'), 't');
  assert.ok(!calls[0].url.includes('t='));
});

test('getForumDiscussions sends forum id, default sort and paging', async () => {
  const calls = [];
  await getForumDiscussions('t', 31, { fetchImpl: ok({ discussions: [] }, calls) });
  await getForumDiscussions('t', 31, { page: 2, perpage: 20, fetchImpl: ok({ discussions: [] }, calls) });
  const a = bodyOf(calls[0]);
  assert.equal(a.get('wsfunction'), 'mod_forum_get_forum_discussions');
  assert.equal(a.get('forumid'), '31');
  assert.equal(a.get('sortorder'), '-1');
  assert.equal(a.get('page'), '0');
  assert.equal(a.get('perpage'), '20');
  assert.equal(bodyOf(calls[1]).get('page'), '2');
});

test('getDiscussionPosts asks for posts oldest first', async () => {
  const calls = [];
  await getDiscussionPosts('t', 101, { fetchImpl: ok({ posts: [] }, calls) });
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'mod_forum_get_discussion_posts');
  assert.equal(b.get('discussionid'), '101');
  assert.equal(b.get('sortby'), 'created');
  assert.equal(b.get('sortdirection'), 'ASC');
});

test('addDiscussionPost sends post id, subject and message exactly once and returns the result', async () => {
  const calls = [];
  const r = await addDiscussionPost('t', 501, 'Re: Verb tenses', '<p>Hola</p>', { fetchImpl: ok({ postid: 999, warnings: [] }, calls) });
  assert.equal(r.postid, 999);
  assert.equal(calls.length, 1);
  const b = bodyOf(calls[0]);
  assert.equal(b.get('wsfunction'), 'mod_forum_add_discussion_post');
  assert.equal(b.get('postid'), '501');
  assert.equal(b.get('subject'), 'Re: Verb tenses');
  assert.equal(b.get('message'), '<p>Hola</p>');
});

test('addDiscussionPost: warnings are errors; a result without postid is an unknown outcome (badresponse)', async () => {
  await assert.rejects(
    () => addDiscussionPost('t', 1, 's', 'm', { fetchImpl: ok({ warnings: [{ warningcode: 'nopermission', message: 'Not allowed' }] }) }),
    (e) => e instanceof MoodleError && e.code === 'nopermission' && e.message === 'Not allowed',
  );
  await assert.rejects(() => addDiscussionPost('t', 1, 's', 'm', { fetchImpl: ok({ warnings: [] }) }), (e) => e.code === 'badresponse');
  await assert.rejects(() => addDiscussionPost('t', 1, 's', 'm', { fetchImpl: ok(null) }), (e) => e.code === 'badresponse');
});
