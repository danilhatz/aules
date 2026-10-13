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
