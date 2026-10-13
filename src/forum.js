import { MoodleError } from './api.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (typeof v === 'string' ? v : '');

export function parseForums(resp) {
  if (!Array.isArray(resp)) throw new MoodleError('badresponse');
  return resp
    .filter((f) => f && Number.isInteger(f.id) && Number.isInteger(f.cmid))
    .map((f) => ({ id: f.id, cmid: f.cmid, name: str(f.name), introHtml: str(f.intro), type: str(f.type) }));
}

export function parseDiscussions(resp) {
  if (!resp || !Array.isArray(resp.discussions)) throw new MoodleError('badresponse');
  return resp.discussions
    .filter((d) => d && Number.isInteger(d.discussion))
    .map((d) => ({
      id: d.discussion,
      title: str(d.name) || str(d.subject),
      author: str(d.userfullname),
      modified: num(d.timemodified),
      replies: num(d.numreplies),
      pinned: d.pinned === true,
      locked: d.locked === true,
      canReply: d.canreply !== false,
    }));
}

export function parsePosts(resp) {
  if (!resp || !Array.isArray(resp.posts)) throw new MoodleError('badresponse');
  return resp.posts
    .filter((p) => p && Number.isInteger(p.id))
    .map((p) => ({
      id: p.id,
      parentId: Number.isInteger(p.parentid) ? p.parentid : 0,
      subject: str(p.subject),
      messageHtml: str(p.message),
      author: str(p.author && p.author.fullname),
      created: num(p.timecreated),
      deleted: p.isdeleted === true,
      canReply: Boolean(p.capabilities && p.capabilities.reply),
      attachments: (Array.isArray(p.attachments) ? p.attachments : [])
        .map((a) => ({ name: str(a && a.filename), url: str(a && a.fileurl) || str(a && a.url) }))
        .filter((a) => a.name && a.url),
    }));
}

export const MAX_DEPTH = 3;

// Display order with indentation depth. Every post appears exactly once, whatever the parent links look like.
export function buildThread(posts) {
  const ids = new Set(posts.map((p) => p.id));
  const kids = new Map();
  const roots = [];
  for (const p of posts) {
    if (p.parentId && p.parentId !== p.id && ids.has(p.parentId)) {
      if (!kids.has(p.parentId)) kids.set(p.parentId, []);
      kids.get(p.parentId).push(p);
    } else {
      roots.push(p);
    }
  }
  const byTime = (a, b) => a.created - b.created || a.id - b.id;
  const out = [];
  const seen = new Set();
  const stack = [];
  const push = (list, depth, parentAuthor) => {
    const sorted = list.slice().sort(byTime);
    for (let i = sorted.length - 1; i >= 0; i -= 1) stack.push({ post: sorted[i], depth, parentAuthor });
  };
  push(roots, 0, '');
  while (stack.length) {
    const { post, depth, parentAuthor } = stack.pop();
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    out.push({ post, depth: Math.min(depth, MAX_DEPTH), replyTo: depth > MAX_DEPTH ? parentAuthor : '' });
    push(kids.get(post.id) || [], depth + 1, post.author);
  }
  // Posts that are only linked to each other (a parent cycle) are not reachable from a root: show them flat.
  for (const p of posts.slice().sort(byTime)) {
    if (!seen.has(p.id)) { seen.add(p.id); out.push({ post: p, depth: 0, replyTo: '' }); }
  }
  return out;
}

export function replySubject(parentSubject) {
  const s = String(parentSubject || '').trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`.trim();
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function replyHtml(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join('');
}

export function canReply(post, discussion = null) {
  return post.canReply && !post.deleted && !(discussion && (discussion.locked || discussion.canReply === false));
}
