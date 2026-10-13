import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCache } from '../src/store.js';
import { createMemoryStorage } from '../src/storage.js';
import { createFolderState } from '../src/folders.js';
import { createDrafts } from '../src/drafts.js';
import {
  sampleCourses, sampleSections, sampleTimelineCourses, sampleAssignmentsResponse, sampleStatusResponse,
} from '../tests/fixtures.js';

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
  // Demo-only fake assignment API: nothing here talks to a network.
  getAssignments: async () => ({
    courses: [{
      ...sampleAssignmentsResponse.courses[0],
      // Always "due in 2 days" in the demo, whatever today's date is.
      assignments: sampleAssignmentsResponse.courses[0].assignments.map((a) => ({ ...a, duedate: Math.floor(Date.now() / 1000) + 2 * 86400 })),
    }],
  }),
  getSubmissionStatus: async () => sampleStatusResponse,
  getUnusedDraftItemId: async () => ({ itemid: 555 }),
  saveSubmission: async () => [],
  submitForGrading: async () => [],
  uploadDraftFile: async (token, file) => ({ itemid: 900, filename: file.name }),
  deleteDraftFiles: async () => [],
};
createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api }),
  cache: createCache(storage),
  folderState: createFolderState(createMemoryStorage()),
  drafts: createDrafts(createMemoryStorage()),
}).start();
