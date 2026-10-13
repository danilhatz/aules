import * as api from './api.js';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createCache } from './store.js';
import { getStorage } from './storage.js';
import { createVault, createIdbKeyStore } from './vault.js';
import { createFolderState } from './folders.js';
import { createDrafts } from './drafts.js';
import { createTimings } from './timings.js';

const storage = getStorage();
const timings = createTimings();
const timedApi = timings.wrap(api);
const vault = createVault({ storage, keyStore: createIdbKeyStore() });
const app = createApp({
  root: document.getElementById('app'),
  api: timedApi,
  timings,
  auth: createAuth({ storage, api: timedApi, vault }),
  cache: createCache(storage),
  folderState: createFolderState(storage),
  drafts: createDrafts(storage),
});
app.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
}
