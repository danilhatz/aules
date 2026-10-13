const F = 'https://aules.edu.gva.es/fpa/webservice/pluginfile.php';

export const sampleCourses = [
  { id: 11, fullname: 'Programació', shortname: 'PRG', progress: 40, overviewfiles: [{ fileurl: `${F}/1/course/overviewfiles/prg.png` }] },
  { id: 12, fullname: 'Sistemes informàtics', shortname: 'SI', progress: null, overviewfiles: [] },
];

export const sampleSections = [
  {
    id: 100, section: 0, name: 'General', summary: '', modules: [
      { id: 1, name: 'Welcome', modname: 'label', uservisible: true, description: '<p>Welcome to the <strong>course</strong>.</p><script>alert(1)</script>' },
      { id: 2, name: 'Syllabus', modname: 'resource', uservisible: true, contents: [{ type: 'file', filename: 'syllabus.pdf', fileurl: `${F}/5/mod_resource/content/1/syllabus.pdf?forcedownload=1` }] },
    ],
  },
  {
    id: 101, section: 1, name: '', summary: '<p>Unit 1 overview</p>', modules: [
      { id: 3, name: 'Docs site', modname: 'url', uservisible: true, contents: [{ type: 'url', fileurl: 'https://example.org/docs' }] },
      { id: 4, name: 'Exercises', modname: 'folder', uservisible: true, contents: [
        { type: 'file', filename: 'ex1.pdf', fileurl: `${F}/6/mod_folder/content/0/ex1.pdf` },
        { type: 'file', filename: 'ex2.pdf', fileurl: `${F}/6/mod_folder/content/0/ex2.pdf` },
      ] },
      { id: 5, name: 'Reading', modname: 'page', uservisible: true, contents: [{ type: 'file', filename: 'index.html', fileurl: `${F}/7/mod_page/content/index.html` }] },
      { id: 6, name: 'Secret', modname: 'resource', uservisible: false, contents: [] },
      { id: 7, name: 'Questions', modname: 'forum', uservisible: true },
      { id: 8, name: 'Glossary', modname: 'glossary', uservisible: true },
      { id: 9, name: 'Tarea 1', modname: 'assign', uservisible: true, description: '' },
    ],
  },
  { id: 102, section: 2, name: 'Empty', summary: '', modules: [] },
];

export const sampleTimelineCourses = [
  { id: 11, fullname: 'Gramática A1', shortname: 'ES-GRA-A1', coursecategory: 'Español A1', progress: 40 },
  { id: 12, fullname: 'Vocabulario A1', shortname: 'ES-VOC-A1', coursecategory: 'Español A1', progress: 10 },
  { id: 13, fullname: 'Cultura y sociedad', shortname: 'ES-CUL-B1', coursecategory: 'Español B1', progress: null },
  { id: 14, fullname: 'Conversación B1', shortname: 'ES-CON-B1', coursecategory: 'Español B1', progress: 75 },
  { id: 15, fullname: 'Taller de escritura', shortname: 'ES-TAL', coursecategory: '', progress: null },
];

const cfg = (plugin, v) => ({ plugin, subtype: 'assignsubmission', name: 'enabled', value: v });

export const sampleAssignmentsResponse = {
  courses: [{ id: 11, assignments: [
    { id: 42, cmid: 9, name: 'Tarea 1', intro: '<p>Escribe un párrafo sobre tu ciudad.</p>', duedate: 1785172800, cutoffdate: 0, allowsubmissionsfromdate: 0,
      submissiondrafts: 1, requiresubmissionstatement: 0, teamsubmission: 0, nosubmissions: 0, configs: [cfg('onlinetext', '1'), cfg('file', '1')], introattachments: [] },
  ] }],
};

export const sampleStatusResponse = {
  lastattempt: { submission: { status: 'draft', plugins: [{ type: 'onlinetext', editorfields: [{ text: '<p>Mi ciudad es bonita.</p>' }] }, { type: 'file', fileareas: [{ area: 'submission_files', files: [] }] }] }, canedit: true, cansubmit: true },
};

const flag = (u, s) => `<div class="questionflag editable"><input type="hidden" name="q${u}:${s}_:flagged" value="0"><input type="checkbox" id="q${u}:${s}_:flaggedcheckbox" name="q${u}:${s}_:flagged" value="1"><label for="q${u}:${s}_:flaggedcheckbox">Flag question</label></div>`;
const frame = (u, s, type, state, body) => `<div id="question-${u}-${s}" class="que ${type} deferredfeedback notyetanswered"><div class="info"><h3 class="no">Question <span class="qno">${s}</span></h3><div class="state">${state}</div><div class="grade">Marked out of 1.00</div>${flag(u, s)}</div><div class="content"><div class="formulation clearfix"><input type="hidden" name="q${u}:${s}_:sequencecheck" value="1">${body}</div></div></div>`;
const radio = (u, s, i, label) => `<div class="r${i % 2}"><input type="radio" name="q${u}:${s}_answer" value="${i}" id="q${u}:${s}_answer${i}"><div class="d-flex w-100"><label for="q${u}:${s}_answer${i}" class="ms-1"><span class="answernumber">${String.fromCharCode(97 + i)}. </span>${label}</label></div></div>`;

export const mcqHtml = (u = 5, s = 1) => frame(u, s, 'multichoice', 'Not yet answered',
  `<div class="qtext"><p>What is the capital of Spain?</p></div><div class="ablock"><fieldset><legend class="prompt h6 fw-normal">Select one:</legend><div class="answer">${radio(u, s, 0, 'Madrid')}${radio(u, s, 1, 'Barcelona')}${radio(u, s, 2, 'Sevilla')}<div class="r1"><input type="radio" name="q${u}:${s}_clearchoice" value="-1" id="q${u}:${s}_clearchoice"><label for="q${u}:${s}_clearchoice">Clear my choice</label></div></div></fieldset></div>`);

export const tfHtml = (u = 6, s = 2) => frame(u, s, 'truefalse', 'Not yet answered',
  `<div class="qtext"><p>Madrid is in Spain.</p></div><div class="ablock"><fieldset><legend class="prompt h6 fw-normal">Select one:</legend><div class="answer"><div class="r0"><input type="radio" name="q${u}:${s}_answer" value="1" id="q${u}:${s}_answer1"><label for="q${u}:${s}_answer1">True</label></div><div class="r1"><input type="radio" name="q${u}:${s}_answer" value="0" id="q${u}:${s}_answer0"><label for="q${u}:${s}_answer0">False</label></div></div></fieldset></div>`);

export const shortHtml = (u = 7, s = 3) => frame(u, s, 'shortanswer', 'Not yet answered',
  `<div class="qtext"><p>Write the Spanish word for "house".</p></div><div class="ablock"><label class="sr-only" for="q${u}:${s}_answer">Answer</label><span class="answer"><input type="text" name="q${u}:${s}_answer" value="" id="q${u}:${s}_answer" size="30" class="form-control d-inline"></span></div>`);

export const numericalHtml = (u = 8, s = 4) => frame(u, s, 'numerical', 'Not yet answered',
  `<div class="qtext"><p>What is 6 x 7?</p></div><div class="ablock"><label class="sr-only" for="q${u}:${s}_answer">Answer</label><span class="answer"><input type="text" name="q${u}:${s}_answer" value="" id="q${u}:${s}_answer" size="30" inputmode="decimal"></span></div>`);
