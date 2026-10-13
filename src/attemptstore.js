const P = 'aules.attempt.';
const INDEX = 'aules.attempts.__index';

export function createAttemptStore(storage) {
  const readIndex = () => {
    try { return JSON.parse(storage.getItem(INDEX)) || []; } catch { return []; }
  };
  const read = (id) => {
    try {
      const v = JSON.parse(storage.getItem(P + id));
      return v && typeof v.pages === 'object' && v.pages ? v : null;
    } catch { return null; }
  };
  return {
    get(attemptId, page) {
      const v = read(attemptId);
      return v && v.pages[String(page)] ? v.pages[String(page)] : null;
    },
    set(attemptId, page, snapshot) {
      try {
        const key = String(attemptId);
        const idx = readIndex();
        if (!idx.includes(key)) storage.setItem(INDEX, JSON.stringify([...idx, key])); // index first: no orphans
        const current = read(key) || { pages: {} };
        current.pages[String(page)] = snapshot;
        storage.setItem(P + key, JSON.stringify({ pages: current.pages, savedAt: Date.now() }));
      } catch { /* best effort */ }
    },
    remove(attemptId) {
      try { storage.removeItem(P + attemptId); } catch { /* best effort */ }
    },
    clear() {
      try {
        for (const id of readIndex()) storage.removeItem(P + id);
        storage.removeItem(INDEX);
      } catch { /* best effort */ }
    },
  };
}
