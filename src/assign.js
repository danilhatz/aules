const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);

export function enabledPlugins(configs) {
  const on = (plugin) => list(configs).some((c) => c && c.plugin === plugin && c.subtype === 'assignsubmission' && c.name === 'enabled' && String(c.value) === '1');
  return { onlinetext: on('onlinetext'), file: on('file') };
}

const cfg = (configs, plugin, name) => {
  const c = list(configs).find((x) => x && x.plugin === plugin && x.name === name);
  return c ? num(c.value) : 0;
};

const fileList = (files) => list(files)
  .filter((f) => f && f.fileurl)
  .map((f) => ({ name: String(f.filename || ''), url: f.fileurl, size: num(f.filesize) }));

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
const stripTags = (html) => decode(html.replace(/<[^>]*>/g, '')).trim();

export function htmlToPlain(html) {
  const src = String(html || '');
  if (!src.trim()) return { plain: '', simple: true };
  const tags = [...src.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)].map((m) => m[1].toLowerCase());
  const simple = tags.every((t) => t === 'p' || t === 'br');
  let t = src.replace(/\r?\n/g, ' '); // source newlines are not significant in HTML
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<\/?p[^>]*>/gi, '');
  t = t.replace(/<[^>]*>/g, '');
  return { plain: decode(t).trim(), simple };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function textToHtml(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

export function parseAssignment(raw) {
  const r = raw || {};
  return {
    id: r.id,
    cmid: r.cmid,
    name: r.name || '',
    introHtml: r.intro || '',
    attachments: fileList(r.introattachments),
    dueDate: num(r.duedate),
    allowFrom: num(r.allowsubmissionsfromdate),
    cutoff: num(r.cutoffdate),
    noSubmissions: Boolean(num(r.nosubmissions)),
    drafts: Boolean(num(r.submissiondrafts)),
    team: Boolean(num(r.teamsubmission)),
    statement: { required: Boolean(num(r.requiresubmissionstatement)), html: r.submissionstatement || '' },
    plugins: enabledPlugins(r.configs),
    maxFiles: cfg(r.configs, 'file', 'maxfilesubmissions'),
    maxBytes: cfg(r.configs, 'file', 'maxsubmissionsizebytes'),
  };
}

export function parseStatus(raw) {
  const last = (raw && raw.lastattempt) || {};
  const sub = last.submission || {};
  const plugins = list(sub.plugins);
  const textPlugin = plugins.find((p) => p && p.type === 'onlinetext');
  const field = textPlugin ? list(textPlugin.editorfields)[0] : null;
  const filePlugin = plugins.find((p) => p && p.type === 'file');
  const areas = filePlugin ? list(filePlugin.fileareas) : [];
  const area = areas.find((a) => a && a.area === 'submission_files') || areas[0] || null;
  const fb = (raw && raw.feedback) || {};
  const comments = list(fb.plugins).find((p) => p && p.type === 'comments');
  const cField = comments ? list(comments.editorfields)[0] : null;
  const html = field && field.text ? String(field.text) : '';
  const plain = htmlToPlain(html);
  const grade = fb.gradefordisplay ? stripTags(String(fb.gradefordisplay)) : '';
  return {
    status: ['new', 'draft', 'submitted', 'reopened'].includes(sub.status) ? sub.status : 'new',
    canEdit: last.canedit === true,
    canSubmit: last.cansubmit === true,
    locked: last.locked === true,
    graded: last.graded === true,
    extensionDue: num(last.extensionduedate),
    text: { html, plain: plain.plain, simple: plain.simple },
    files: fileList(area && area.files),
    gradeText: /^[-–—]?$/.test(grade) ? '' : grade,
    feedbackHtml: cField && cField.text ? String(cField.text) : '',
  };
}

export function badgeState(status) {
  if (status.graded || status.gradeText) return 'graded';
  if (status.status === 'submitted') return 'submitted';
  if (status.status === 'draft') return 'draft';
  return 'notsubmitted';
}

export function editability(assignment, status, now) {
  if (assignment.team) return { editable: false, reason: 'team' };
  if (assignment.noSubmissions) return { editable: false, reason: 'nosubmissions' };
  if (!assignment.plugins.onlinetext && !assignment.plugins.file) return { editable: false, reason: 'noplugins' };
  if (assignment.allowFrom && now < assignment.allowFrom) return { editable: false, reason: 'notopen' };
  if (status.locked) return { editable: false, reason: 'locked' };
  if (assignment.cutoff && now > Math.max(assignment.cutoff, status.extensionDue)) return { editable: false, reason: 'cutoff' };
  if (!status.canEdit) return { editable: false, reason: status.status === 'submitted' ? 'submitted' : 'notallowed' };
  return { editable: true, reason: '' };
}

export function buildPlugindata({ text, textChanged, textItemId, filesChanged, filesItemId }) {
  const data = {};
  if (textChanged) data.onlinetext_editor = { text: textToHtml(text), format: 1, itemid: textItemId };
  if (filesChanged) data.files_filemanager = filesItemId;
  return data;
}

export function formatDue(ts, now, locale) {
  if (!ts) return { has: false, absolute: '', relative: '', overdue: false };
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let relative;
  if (abs < 3600) relative = rtf.format(Math.round(diff / 60), 'minute');
  else if (abs < 86400) relative = rtf.format(Math.round(diff / 3600), 'hour');
  else relative = rtf.format(Math.round(diff / 86400), 'day');
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts * 1000));
  return { has: true, absolute, relative, overdue: diff < 0 };
}
