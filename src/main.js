import * as api from './api.js';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createCache } from './store.js';
import { getStorage } from './storage.js';
import { createVault, createIdbKeyStore } from './vault.js';
import { createFolderState } from './folders.js';
import { createDrafts } from './drafts.js';

const storage = getStorage();
const vault = createVault({ storage, keyStore: createIdbKeyStore() });
const app = createApp({
  root: document.getElementById('app'),
  api,
  auth: createAuth({ storage, api, vault }),
  cache: createCache(storage),
  folderState: createFolderState(storage),
  drafts: createDrafts(storage),
});
app.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
}
