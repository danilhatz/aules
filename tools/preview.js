import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCache } from '../src/store.js';
import { createMemoryStorage } from '../src/storage.js';
import { createFolderState } from '../src/folders.js';
import { createDrafts } from '../src/drafts.js';
import { createAttemptStore } from '../src/attemptstore.js';
import {
  sampleCourses, sampleSections, sampleTimelineCourses, sampleAssignmentsResponse, sampleStatusResponse,
  sampleQuizzesResponse, sampleQuizAccess, sampleQtypes, sampleAttemptAccess, sampleNoAttempts, sampleBest, sampleAttemptPage, mcqHtml,
} from '../tests/fixtures.js';

let demoAttempts = sampleNoAttempts;
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
  // Demo-only fake quiz API: a two-page quiz that can be started, answered, finished and reviewed.
  getQuizzes: async () => ({ quizzes: sampleQuizzesResponse.quizzes.map((q) => ({ ...q, timeclose: Math.floor(Date.now() / 1000) + 3 * 86400 })) }),
  getQuizAccess: async () => sampleQuizAccess,
  getAttemptAccess: async () => sampleAttemptAccess,
  getQuizQtypes: async () => sampleQtypes,
  getUserAttempts: async () => demoAttempts,
  getBestGrade: async () => sampleBest,
  startAttempt: async () => {
    demoAttempts = { attempts: [{ id: 77, attempt: 1, state: 'inprogress', currentpage: 0 }] };
    return { attempt: { id: 77, currentpage: 0 }, warnings: [] };
  },
  getAttemptData: async (t, id, page) => sampleAttemptPage(page, page === 0 ? 1 : -1),
  saveAttempt: async () => ({ status: true, warnings: [] }),
  processAttempt: async (t, id, d, o) => {
    if (o && o.finish) demoAttempts = { attempts: [{ id: 77, attempt: 1, state: 'finished', sumgrades: 1, currentpage: 1 }] };
    return { state: 'inprogress', warnings: [] };
  },
  getAttemptSummary: async () => ({ questions: [{ slot: 1, state: 'complete' }, { slot: 2, state: 'todo' }] }),
  getAttemptReview: async () => ({ grade: '5.00 out of 10.00', attempt: { id: 77 }, questions: [{ slot: 1, number: 1, type: 'multichoice', html: mcqHtml(5, 1) }], warnings: [] }),
};
createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api }),
  cache: createCache(storage),
  folderState: createFolderState(createMemoryStorage()),
  drafts: createDrafts(createMemoryStorage()),
  attemptStore: createAttemptStore(createMemoryStorage()),
}).start();
