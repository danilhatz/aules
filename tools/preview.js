import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCache } from '../src/store.js';
import { createMemoryStorage } from '../src/storage.js';
import { createFolderState } from '../src/folders.js';
import { sampleCourses, sampleSections, sampleTimelineCourses } from '../tests/fixtures.js';

const storage = createMemoryStorage();
storage.setItem('aules.session', JSON.stringify({ token: 'demo', userid: 1, fullname: 'Demo' }));
const api = {
  requestToken: async () => 'demo',
  getSiteInfo: async () => ({
    release: '4.1 (demo)', version: '2022112800', usermaxuploadfilesize: 52428800, usercanmanageownfiles: true,
    functions: [{ name: 'core_course_get_categories' }, { name: 'mod_assign_save_submission' }],
  }),
  getCoursesByTimeline: async () => ({ courses: sampleTimelineCourses }),
  getCourses: async () => sampleCourses,
  getCourseContents: async () => sampleSections,
};
createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api }),
  cache: createCache(storage),
  folderState: createFolderState(createMemoryStorage()),
}).start();
