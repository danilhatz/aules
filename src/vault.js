const KEY = 'aules.vault';

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createMemoryKeyStore() {
  let key = null;
  return {
    get: async () => key,
    set: async (k) => { key = k; },
    clear: async () => { key = null; },
  };
}

export function createIdbKeyStore(idb = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const r = idb.open('aules-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => { db.close(); resolve(req.result ?? null); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: () => run('readonly', (s) => s.get('k')),
    set: (key) => run('readwrite', (s) => s.put(key, 'k')),
    clear: () => run('readwrite', (s) => s.delete('k')),
  };
}

// Some iOS WebKit builds never fire onsuccess/onerror for indexedDB.open; never wait forever.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('key store timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createVault({ storage, keyStore, crypto = globalThis.crypto, timeoutMs = 3000 }) {
  async function getKey(create) {
    let key = await withTimeout(keyStore.get(), timeoutMs);
    if (!key && create) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await withTimeout(keyStore.set(key), timeoutMs);
    }
    return key || null;
  }
  return {
    async save(username, password) {
      try {
        const key = await getKey(true);
        if (!key) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = new TextEncoder().encode(JSON.stringify({ username, password }));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
        storage.setItem(KEY, JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
        return true;
      } catch {
        return false;
      }
    },
    async load() {
      try {
        const rec = JSON.parse(storage.getItem(KEY));
        const key = await getKey(false);
        if (!rec || !key) return null;
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
        const c = JSON.parse(new TextDecoder().decode(plain));
        return c.username && c.password ? { username: c.username, password: c.password } : null;
      } catch {
        return null;
      }
    },
    async clear() {
      storage.removeItem(KEY);
      try { if (keyStore.clear) await withTimeout(keyStore.clear(), timeoutMs); } catch { /* nothing to wipe */ }
    },
  };
}
