const NAME = /^q\d+:\d+_:?[A-Za-z0-9_-]+$/;
const ID = /^q\d+:\d+_[A-Za-z0-9:_-]+$/;
const isFlag = (n) => /:flagged$/.test(n);
export const isValidFieldName = (n) => typeof n === 'string' && NAME.test(n) && !isFlag(n);

const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'link', 'meta', 'base', 'noscript', 'template', 'audio', 'video', 'button', 'canvas']);
const KEEP = new Set(['div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'sub', 'sup', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'label', 'fieldset', 'legend', 'input', 'select', 'option', 'textarea', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
  'u', 's', 'del', 'ins', 'small', 'hr', 'blockquote', 'caption', 'figure', 'figcaption']);
const CLASSES = new Set(['que', 'correct', 'incorrect', 'partiallycorrect', 'state', 'grade', 'qtext', 'answer', 'rightanswer', 'specificfeedback', 'generalfeedback', 'outcome', 'feedback', 'prompt', 'ablock', 'formulation', 'content', 'info', 'no', 'qno', 'multichoice', 'truefalse', 'shortanswer', 'numerical', 'description']);
const INPUT_TYPES = new Set(['radio', 'checkbox', 'text', 'hidden']);

function safeLink(url, imageOnly) {
  try {
    const p = new URL(url, 'https://base.invalid').protocol;
    return p === 'http:' || p === 'https:' || (!imageOnly && p === 'mailto:');
  } catch {
    return false;
  }
}

function keepOnly(el, allowed) {
  for (const a of Array.from(el.attributes)) if (!allowed.includes(a.name)) el.removeAttribute(a.name);
}

function filterClass(el) {
  const kept = (el.getAttribute('class') || '').split(/\s+/).filter((t) => CLASSES.has(t));
  if (kept.length) el.setAttribute('class', kept.join(' '));
  else el.removeAttribute('class');
}

// Returns false when the element must be removed.
function cleanElement(el, tag, ctx) {
  if (el.classList.contains('questionflag')) return false; // must be checked before unknown classes are stripped
  filterClass(el);
  switch (tag) {
    case 'input': {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (!INPUT_TYPES.has(type) || !isValidFieldName(el.getAttribute('name'))) return false;
      if (el.hasAttribute('id') && !ID.test(el.getAttribute('id'))) el.removeAttribute('id');
      keepOnly(el, ['type', 'name', 'value', 'id', 'checked', 'disabled', 'readonly', 'size', 'maxlength', 'inputmode', 'class']);
      el.setAttribute('type', type);
      if (!ctx.interactive) el.setAttribute('disabled', '');
      return true;
    }
    case 'textarea':
    case 'select': {
      if (!isValidFieldName(el.getAttribute('name'))) return false;
      if (el.hasAttribute('id') && !ID.test(el.getAttribute('id'))) el.removeAttribute('id');
      keepOnly(el, ['name', 'id', 'rows', 'cols', 'disabled', 'readonly', 'class']);
      if (!ctx.interactive) el.setAttribute('disabled', '');
      return true;
    }
    case 'option':
      keepOnly(el, ['value', 'selected']);
      return true;
    case 'label': {
      const f = el.getAttribute('for');
      keepOnly(el, ['for', 'class']);
      if (f && !ID.test(f)) el.removeAttribute('for');
      return true;
    }
    case 'a': {
      const href = el.getAttribute('href');
      keepOnly(el, ['href', 'title', 'class']);
      if (href && safeLink(href, false)) {
        el.setAttribute('href', ctx.rewriteUrl ? ctx.rewriteUrl(href) : href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        el.removeAttribute('href');
      }
      return true;
    }
    case 'img': {
      const src = el.getAttribute('src');
      if (!src || !safeLink(src, true)) return false;
      keepOnly(el, ['src', 'alt', 'width', 'height', 'class']);
      el.setAttribute('src', ctx.rewriteUrl ? ctx.rewriteUrl(src) : src);
      return true;
    }
    default:
      keepOnly(el, ['class', 'colspan', 'rowspan']);
      return true;
  }
}

// Moodle 4.x names a radio through aria-labelledby pointing at a div. Turn that div into a real <label for>,
// so the answer text names the control for screen readers and tapping it selects the answer.
function asLabel(el) {
  if (el.localName !== 'div' || el.getAttribute('data-region') !== 'answer-label') return el;
  const m = /^(q\d+:\d+_[A-Za-z0-9:_-]+)_label$/.exec(el.getAttribute('id') || '');
  if (!m) return el;
  const label = el.ownerDocument.createElement('label');
  label.setAttribute('for', m[1]);
  label.setAttribute('class', el.getAttribute('class') || '');
  while (el.firstChild) label.append(el.firstChild);
  el.replaceWith(label);
  return label;
}

function walk(node, ctx) {
  for (const original of Array.from(node.childNodes)) {
    if (original.nodeType === 3) continue;
    if (original.nodeType !== 1) { original.remove(); continue; }
    const child = asLabel(original);
    const tag = child.localName;
    if (DROP.has(tag)) { child.remove(); continue; }
    if (!KEEP.has(tag)) {
      walk(child, ctx);
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    if (!cleanElement(child, tag, ctx)) { child.remove(); continue; }
    walk(child, ctx);
  }
}

export function sanitizeQuestionHtml(html, { rewriteUrl, interactive = true, DOMParserCtor } = {}) {
  const Parser = DOMParserCtor || globalThis.DOMParser;
  const doc = new Parser().parseFromString(String(html || ''), 'text/html');
  walk(doc.body, { rewriteUrl, interactive });
  return doc.body.innerHTML;
}

const controls = (container) => Array.from(container.querySelectorAll('input, select, textarea'));

// Same as submitting the web form: hidden always, radio/checkbox only when checked, enabled controls only.
export function collectAnswers(container) {
  const out = [];
  for (const el of controls(container)) {
    const name = el.getAttribute('name');
    if (!isValidFieldName(name) || el.disabled) continue;
    if (el.localName === 'input') {
      const type = el.type;
      if (type === 'radio' || type === 'checkbox') {
        if (el.checked) out.push({ name, value: el.value });
      } else if (type === 'hidden' || type === 'text') {
        out.push({ name, value: el.value });
      }
    } else {
      out.push({ name, value: el.value });
    }
  }
  return out;
}

export function snapshotAnswers(container) {
  const t = {};
  const c = {};
  for (const el of controls(container)) {
    const name = el.getAttribute('name');
    if (!isValidFieldName(name) || el.disabled) continue;
    if (el.localName === 'input' && (el.type === 'radio' || el.type === 'checkbox')) c[`${name}|${el.value}`] = el.checked;
    else if (!(el.localName === 'input' && el.type === 'hidden')) t[name] = el.value;
  }
  return { t, c };
}

export function restoreSnapshot(container, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const t = snapshot.t || {};
  const c = snapshot.c || {};
  for (const el of controls(container)) {
    const name = el.getAttribute('name');
    if (!isValidFieldName(name) || el.disabled) continue;
    if (el.localName === 'input' && (el.type === 'radio' || el.type === 'checkbox')) {
      const key = `${name}|${el.value}`;
      if (key in c) el.checked = Boolean(c[key]);
    } else if (!(el.localName === 'input' && el.type === 'hidden') && name in t) {
      el.value = String(t[name]);
    }
  }
}
