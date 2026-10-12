import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createCache } from '../src/store.js';
import { createMemoryStorage } from '../src/storage.js';
import { sampleCourses, sampleSections } from '../tests/fixtures.js';

const storage = createMemoryStorage();
storage.setItem('aules.session', JSON.stringify({ token: 'demo', userid: 1, fullname: 'Demo' }));
const api = {
  requestToken: async () => 'demo',
  getSiteInfo: async () => ({ userid: 1, fullname: 'Demo' }),
  getCourses: async () => sampleCourses,
  getCourseContents: async () => sampleSections,
};
createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api }),
  cache: createCache(storage),
}).start();
