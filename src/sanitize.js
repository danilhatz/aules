const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'link', 'meta', 'base', 'noscript', 'template', 'audio', 'video', 'input', 'button', 'textarea', 'select']);
const KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'hr', 'sub', 'sup', 'figure', 'figcaption']);
const ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };

export function isSafeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeLink(url) {
  try {
    const p = new URL(url, 'https://base.invalid').protocol;
    return p === 'http:' || p === 'https:' || p === 'mailto:';
  } catch {
    return false;
  }
}

function cleanAttrs(el, tag, rewriteUrl) {
  const allowed = ATTRS[tag] || [];
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.includes(attr.name)) el.removeAttribute(attr.name);
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    const v = el.getAttribute('href');
    if (isSafeLink(v)) el.setAttribute('href', rewriteUrl ? rewriteUrl(v) : v);
    else el.removeAttribute('href');
  }
  if (tag === 'img' && el.hasAttribute('src')) {
    const v = el.getAttribute('src');
    if (isSafeLink(v) && !v.trim().toLowerCase().startsWith('mailto:')) el.setAttribute('src', rewriteUrl ? rewriteUrl(v) : v);
    else el.removeAttribute('src');
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function clean(node, rewriteUrl) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
    const tag = child.localName;
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child, rewriteUrl);
    if (KEEP.has(tag)) {
      cleanAttrs(child, tag, rewriteUrl);
    } else {
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
    }
  }
}

export function sanitizeHtml(html, { rewriteUrl, DOMParserCtor } = {}) {
  const Parser = DOMParserCtor || globalThis.DOMParser;
  const doc = new Parser().parseFromString(String(html || ''), 'text/html');
  clean(doc.body, rewriteUrl);
  return doc.body.innerHTML;
}
