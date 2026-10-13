import { SITE_URL } from './config.js';
import { STRINGS as S } from './strings.js';
import { isSafeHttpUrl } from './sanitize.js';

const SITE = new URL(SITE_URL);
const FILE_PREFIX = `${SITE.pathname}/webservice/pluginfile.php/`;

// The token is only valid for this Moodle instance's web-service file endpoint;
// aules hosts other instances under other paths, so match the full path prefix.
export function withToken(url, token) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.origin !== SITE.origin || !u.pathname.startsWith(FILE_PREFIX)) return url;
  u.searchParams.set('token', token);
  return u.toString();
}

const SOON = new Set();
const PLAIN_PREFIX =`${SITE.pathname}/pluginfile.php/`;

// Moodle hands out plain /pluginfile.php/ image URLs in some responses; the token only works on the webservice path.
export function toWebserviceUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.origin !== SITE.origin || !u.pathname.startsWith(PLAIN_PREFIX)) return url;
  u.pathname = FILE_PREFIX + u.pathname.slice(PLAIN_PREFIX.length);
  return u.toString();
}

const hasText = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';

function fileLinks(files, token, labelOf) {
  return files
    .map((f) => ({ label: labelOf(f), href: withToken(f.fileurl, token) }))
    .filter((l) => isSafeHttpUrl(l.href));
}

function buildModule(m, token) {
  const base = { id: m.id, name: m.name || '', modname: m.modname || '', description: m.description || '', links: [] };
  const files = (m.contents || []).filter((c) => c.type === 'file');
  switch (m.modname) {
    case 'label':
      return { ...base, kind: 'label', name: '' };
    case 'resource':
      return { ...base, kind: 'file', links: fileLinks(files, token, (f) => f.filename) };
    case 'folder':
      return { ...base, kind: 'folder', links: fileLinks(files, token, (f) => f.filename) };
    case 'page':
      return { ...base, kind: 'page', links: fileLinks(files.slice(0, 1), token, () => base.name) };
    case 'assign':
      return { ...base, kind: 'assign' };
    case 'quiz':
      return { ...base, kind: 'quiz' };
    case 'forum':
      return { ...base, kind: 'forum' };
    case 'url': {
      const u = (m.contents || []).find((c) => c.type === 'url');
      const links = u && isSafeHttpUrl(u.fileurl) ? [{ label: base.name, href: u.fileurl, external: true }] : [];
      return { ...base, kind: 'url', links };
    }
    default:
      return { ...base, kind: 'other', unsupported: true, ...(SOON.has(m.modname) ? { soon: true } : {}) };
  }
}

export function buildCourse(sections, token) {
  return (sections || [])
    .map((s, i) => ({
      id: s.id,
      number: s.section ?? i,
      name: (s.name || '').trim() || `${S.section} ${s.section ?? i}`,
      summary: s.summary || '',
      modules: (s.modules || []).filter((m) => m.uservisible !== false).map((m) => buildModule(m, token)),
    }))
    .filter((s) => s.modules.length || hasText(s.summary));
}
