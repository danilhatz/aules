import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabledPlugins, htmlToPlain, textToHtml, parseAssignment, parseStatus, editability, buildPlugindata, formatDue, badgeState,
} from '../src/assign.js';

const cfgs = [
  { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '1' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '0' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'maxfilesubmissions', value: '3' },
  { plugin: 'file', subtype: 'assignsubmission', name: 'maxsubmissionsizebytes', value: '1048576' },
  { plugin: 'comments', subtype: 'assignfeedback', name: 'enabled', value: '1' },
];

test('enabledPlugins reads only assignsubmission enabled flags and tolerates junk', () => {
  assert.deepEqual(enabledPlugins(cfgs), { onlinetext: true, file: false });
  assert.deepEqual(enabledPlugins(undefined), { onlinetext: false, file: false });
  assert.deepEqual(enabledPlugins([null, 5, { plugin: 'file' }]), { onlinetext: false, file: false });
});

test('textToHtml escapes hostile text and keeps paragraphs and line breaks', () => {
  assert.equal(textToHtml(''), '');
  assert.equal(textToHtml('  \n '), '');
  assert.equal(textToHtml('a'), '<p>a</p>');
  assert.equal(textToHtml('a\nb\n\n\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(textToHtml('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(textToHtml(`<script>alert("x")</script> & 'q'`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
});

test('htmlToPlain round-trips text produced by textToHtml (incl. emoji and entities)', () => {
  for (const t of ['hola', 'a\nb', 'a\n\nb', '5 < 6 & 7 > 3', `"quoted" 'single'`, 'ñandú 🙂', 'x'.repeat(5000)]) {
    const r = htmlToPlain(textToHtml(t));
    assert.equal(r.plain, t);
    assert.equal(r.simple, true);
  }
});

test('htmlToPlain flags formatting and decodes entities after stripping tags', () => {
  assert.deepEqual(htmlToPlain(''), { plain: '', simple: true });
  assert.equal(htmlToPlain('<p dir="ltr" style="text-align: left;">hi</p>').simple, true);
  assert.equal(htmlToPlain('<p>hi <strong>there</strong></p>').simple, false);
  assert.equal(htmlToPlain('<ul><li>a</li></ul>').simple, false);
  assert.equal(htmlToPlain('<img src=x>').simple, false);
  assert.equal(htmlToPlain('<p>&lt;b&gt;not bold&lt;/b&gt;</p>').plain, '<b>not bold</b>');
  assert.equal(htmlToPlain('<p>one</p>\n<p>two</p>').plain, 'one\n\ntwo');
});

const rawAssign = {
  id: 42, cmid: 9, name: 'Tarea 1', intro: '<p>Haz esto</p>', duedate: 1790000000, allowsubmissionsfromdate: 1780000000, cutoffdate: 0,
  nosubmissions: 0, submissiondrafts: 1, teamsubmission: 0, requiresubmissionstatement: 1, submissionstatement: '<p>Es mi trabajo</p>',
  introattachments: [{ filename: 'guia.pdf', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/guia.pdf', filesize: 2048 }, { filename: 'bad' }],
  configs: cfgs,
};

test('parseAssignment normalises fields and tolerates missing ones', () => {
  const a = parseAssignment(rawAssign);
  assert.equal(a.id, 42); assert.equal(a.cmid, 9); assert.equal(a.name, 'Tarea 1');
  assert.equal(a.dueDate, 1790000000); assert.equal(a.cutoff, 0);
  assert.equal(a.drafts, true); assert.equal(a.team, false); assert.equal(a.noSubmissions, false);
  assert.deepEqual(a.statement, { required: true, html: '<p>Es mi trabajo</p>' });
  assert.deepEqual(a.plugins, { onlinetext: true, file: false });
  assert.equal(a.maxFiles, 3); assert.equal(a.maxBytes, 1048576);
  assert.deepEqual(a.attachments, [{ name: 'guia.pdf', url: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/guia.pdf', size: 2048 }]);
  const empty = parseAssignment({ id: 1, cmid: 2 });
  assert.deepEqual(empty.plugins, { onlinetext: false, file: false });
  assert.equal(empty.name, ''); assert.equal(empty.dueDate, 0); assert.deepEqual(empty.attachments, []);
});

const rawStatus = {
  lastattempt: {
    submission: { status: 'draft', plugins: [
      { type: 'onlinetext', editorfields: [{ name: 'onlinetext', text: '<p>mi respuesta</p>', format: 1 }] },
      { type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: 'foto.jpg', fileurl: 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php/1/foto.jpg', filesize: 100 }] }] },
    ] },
    canedit: true, cansubmit: true, locked: false, graded: false, extensionduedate: 0,
  },
  feedback: { gradefordisplay: '<b>8,00</b> / 10,00', plugins: [{ type: 'comments', editorfields: [{ name: 'comments', text: '<p>Bien</p>' }] }] },
};

test('parseStatus extracts text, files, grade and feedback', () => {
  const s = parseStatus(rawStatus);
  assert.equal(s.status, 'draft'); assert.equal(s.canEdit, true); assert.equal(s.canSubmit, true);
  assert.deepEqual(s.text, { html: '<p>mi respuesta</p>', plain: 'mi respuesta', simple: true });
  assert.deepEqual(s.files.map((f) => f.name), ['foto.jpg']);
  assert.equal(s.gradeText, '8,00 / 10,00');
  assert.equal(s.feedbackHtml, '<p>Bien</p>');
});

test('parseStatus never throws on missing pieces and defaults to a safe state', () => {
  for (const raw of [undefined, null, {}, { lastattempt: {} }, { lastattempt: { submission: { status: 'weird', plugins: [null, {}, { type: 'file' }, { type: 'onlinetext' }] } } }]) {
    const s = parseStatus(raw);
    assert.equal(s.status, 'new');
    assert.equal(s.canEdit, false);
    assert.deepEqual(s.files, []);
    assert.equal(s.text.plain, '');
    assert.equal(s.gradeText, '');
  }
  assert.equal(parseStatus({ feedback: { gradefordisplay: '-' } }).gradeText, '');
});

test('badgeState', () => {
  assert.equal(badgeState(parseStatus(rawStatus)), 'graded');
  assert.equal(badgeState({ status: 'new', graded: false, gradeText: '' }), 'notsubmitted');
  assert.equal(badgeState({ status: 'reopened', graded: false, gradeText: '' }), 'notsubmitted');
  assert.equal(badgeState({ status: 'draft', graded: false, gradeText: '' }), 'draft');
  assert.equal(badgeState({ status: 'submitted', graded: false, gradeText: '' }), 'submitted');
});

const NOW = 1785000000;
const A = (o = {}) => ({ ...parseAssignment(rawAssign), plugins: { onlinetext: true, file: true }, allowFrom: 0, ...o });
const S = (o = {}) => ({ ...parseStatus(rawStatus), ...o });

test('editability covers every closed/locked/odd state without throwing', () => {
  assert.deepEqual(editability(A(), S(), NOW), { editable: true, reason: '' });
  assert.equal(editability(A({ team: true }), S(), NOW).reason, 'team');
  assert.equal(editability(A({ noSubmissions: true }), S(), NOW).reason, 'nosubmissions');
  assert.equal(editability(A({ plugins: { onlinetext: false, file: false } }), S(), NOW).reason, 'noplugins');
  assert.equal(editability(A({ allowFrom: NOW + 100 }), S(), NOW).reason, 'notopen');
  assert.equal(editability(A(), S({ locked: true }), NOW).reason, 'locked');
  assert.equal(editability(A({ cutoff: NOW - 10 }), S(), NOW).reason, 'cutoff');
  assert.equal(editability(A({ cutoff: NOW - 10 }), S({ extensionDue: NOW + 1000 }), NOW).editable, true); // extension beats cut-off
  assert.equal(editability(A({ cutoff: 0 }), S(), NOW).editable, true); // no cut-off
  assert.equal(editability(A(), S({ canEdit: false, status: 'submitted' }), NOW).reason, 'submitted');
  assert.equal(editability(A(), S({ canEdit: false, status: 'draft' }), NOW).reason, 'notallowed');
});

test('buildPlugindata includes only the changed plugins', () => {
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: true, textItemId: 5, filesChanged: false, filesItemId: 9 }),
    { onlinetext_editor: { text: '<p>hi</p>', format: 1, itemid: 5 } });
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: false, textItemId: 5, filesChanged: true, filesItemId: 9 }), { files_filemanager: 9 });
  assert.deepEqual(buildPlugindata({ text: 'hi', textChanged: true, textItemId: 5, filesChanged: true, filesItemId: 9 }),
    { onlinetext_editor: { text: '<p>hi</p>', format: 1, itemid: 5 }, files_filemanager: 9 });
  assert.deepEqual(buildPlugindata({ textChanged: false, filesChanged: false }), {});
});

test('formatDue gives relative and absolute text and flags overdue', () => {
  assert.deepEqual(formatDue(0, NOW, 'en'), { has: false, absolute: '', relative: '', overdue: false });
  const future = formatDue(NOW + 2 * 86400, NOW, 'en');
  assert.equal(future.has, true); assert.equal(future.relative, 'in 2 days'); assert.equal(future.overdue, false);
  assert.match(future.absolute, /\d{4}/);
  const past = formatDue(NOW - 3 * 3600, NOW, 'en');
  assert.equal(past.relative, '3 hours ago'); assert.equal(past.overdue, true);
  assert.equal(formatDue(NOW + 5 * 60, NOW, 'en').relative, 'in 5 minutes');
});
