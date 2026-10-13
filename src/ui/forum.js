import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';
import { sanitizeHtml, isSafeHttpUrl } from '../sanitize.js';
import { withToken, toWebserviceUrl } from '../content.js';
import { buildThread, canReply } from '../forum.js';

function errorText(err) {
  const base = describeError(err);
  const detail = err && err.message && err.message !== err.code && !S.errors[err.code] ? ` ${err.message}` : '';
  return base + detail;
}

const when = (ts, locale) => (ts ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts * 1000)) : '');
const backLink = (href, label) => h('a', { class: 'back', href }, '‹ ', label);

function topicRow(p, t) {
  return h('li', { class: 'topic' },
    h('a', { class: 'topic-link', href: `#/course/${p.courseId}/forum/${p.cmid}/topic/${t.id}` }, t.title),
    h('small', { class: 'topic-meta' },
      [t.author, when(t.modified, p.locale), `${S.repliesLabel}: ${t.replies}`].filter(Boolean).join(' · ')),
    t.pinned ? h('span', { class: 'chip' }, S.pinnedLabel) : null,
    t.locked ? h('span', { class: 'chip' }, S.lockedLabel) : null);
}

export function renderForum(p) {
  const rewriteUrl = (u) => withToken(toWebserviceUrl(u), p.token);
  const intro = h('div', { class: 'html intro' });
  intro.innerHTML = sanitizeHtml(p.forum.introHtml, { rewriteUrl });
  const list = h('ul', { class: 'topics' }, p.topics.map((t) => topicRow(p, t)));
  const empty = h('p', { class: 'note', hidden: p.topics.length > 0 }, S.noTopics);
  const msg = h('p', { class: 'form-msg', role: 'alert' }, '');
  let more = null;
  if (p.hasMore && p.fresh && !p.offline) {
    more = h('button', {
      type: 'button',
      class: 'btn secondary',
      onclick: async () => {
        more.disabled = true;
        msg.textContent = '';
        try {
          const r = await p.actions.loadMore();
          for (const t of r.topics) list.append(topicRow(p, t));
          empty.hidden = list.children.length > 0;
          if (r.hasMore) more.disabled = false;
          else more.hidden = true;
        } catch (err) {
          if (err && err.code === 'signedout') return;
          msg.textContent = errorText(err);
          more.disabled = false;
        }
      },
    }, S.loadMore);
  }
  return h('article', { class: 'course forum' },
    h('header', { class: 'bar' }, backLink(`#/course/${p.courseId}`, S.backToCourse), h('h2', {}, p.forum.name)),
    ...(p.offline ? [h('p', { class: 'banner' }, S.offline)] : []),
    intro, list, empty, more, msg);
}

export function renderTopic(p) {
  const rewriteUrl = (u) => withToken(toWebserviceUrl(u), p.token);
  const flashText = { sent: S.replySent, unknown: S.unconfirmed }[p.flash] || '';
  const replyAllowed = p.fresh && !p.offline;
  let busy = false;
  const locks = [];
  const setBusy = (b) => { busy = b; for (const x of locks) x.disabled = b; };

  function replyBlock(post) {
    const area = h('textarea', { class: 'reply-text', rows: 4, 'aria-label': S.yourReply });
    area.value = p.draftOf(post.id) || '';
    area.addEventListener('input', () => p.onDraft(post.id, area.value));
    const msg = h('p', { class: 'form-msg', role: 'alert' }, '');
    const yes = h('button', {
      type: 'button',
      class: 'btn confirm-btn',
      onclick: async () => {
        if (busy) return;
        setBusy(true);
        msg.textContent = '';
        try {
          await p.actions.send(post, area.value);
          p.onDone('sent');
        } catch (err) {
          if (err && err.code === 'signedout') return;
          if (err && err.code === 'unconfirmed') { p.onDone('unknown'); return; }
          msg.textContent = errorText(err);
          setBusy(false);
        }
      },
    }, S.confirmSendYes);
    const cancel = h('button', { type: 'button', class: 'btn secondary', onclick: () => { confirm.hidden = true; } }, S.cancel);
    const confirm = h('div', { class: 'confirm', hidden: true, role: 'group' }, h('p', {}, S.confirmReplyText), yes, cancel);
    const send = h('button', {
      type: 'button',
      class: 'btn',
      onclick: () => {
        if (busy) return;
        if (!area.value.trim()) { msg.textContent = S.replyEmpty; return; }
        msg.textContent = '';
        confirm.hidden = false;
      },
    }, S.sendReply);
    locks.push(area, send, yes, cancel);
    return h('div', { class: 'reply-box', hidden: true }, area, send, confirm, msg);
  }

  function postEl({ post, depth, replyTo }) {
    const body = h('div', { class: 'html message' });
    if (!post.deleted) body.innerHTML = sanitizeHtml(post.messageHtml, { rewriteUrl });
    const files = post.attachments.map((a) => ({ name: a.name, href: rewriteUrl(a.url) })).filter((a) => isSafeHttpUrl(a.href));
    const showSubject = post.subject && !/^re:/i.test(post.subject) && post.subject !== p.title;
    const el = h('article', { class: `post depth-${depth}`, 'data-id': String(post.id) },
      h('header', { class: 'post-head' },
        h('strong', {}, post.author),
        post.created ? h('small', { class: 'muted' }, ` ${when(post.created, p.locale)}`) : null),
      showSubject ? h('h4', {}, post.subject) : null,
      replyTo ? h('small', { class: 'muted' }, S.inReplyTo.replace('{name}', replyTo)) : null,
      post.deleted ? h('p', { class: 'note' }, S.postRemoved) : body,
      !post.deleted && files.length
        ? h('ul', { class: 'links' }, files.map((a) => h('li', {},
          h('a', { href: a.href, target: '_blank', rel: 'noopener noreferrer' }, a.name))))
        : null);
    if (replyAllowed && canReply(post, p.discussion)) {
      const box = replyBlock(post);
      const toggle = h('button', { type: 'button', class: 'link reply-btn', onclick: () => { box.hidden = !box.hidden; } }, S.reply);
      locks.push(toggle);
      el.append(toggle, box);
    }
    return el;
  }

  return h('article', { class: 'course topic' },
    h('header', { class: 'bar' }, backLink(`#/course/${p.courseId}/forum/${p.cmid}`, S.backToForum), h('h2', {}, p.title)),
    ...(flashText ? [h('p', { class: `banner flash flash-${p.flash}`, role: 'status' }, flashText)] : []),
    ...(p.offline ? [h('p', { class: 'banner' }, S.offline), h('p', { class: 'banner' }, S.offlineNoEdit)] : []),
    h('div', { class: 'posts' }, buildThread(p.posts).map(postEl)));
}
