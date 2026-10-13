const P = 'aules.draft.';
const INDEX = 'aules.drafts.__index';

export function createDrafts(storage) {
  const readIndex = () => {
    try { return JSON.parse(storage.getItem(INDEX)) || []; } catch { return []; }
  };
  return {
    get(id) {
      try {
        const v = JSON.parse(storage.getItem(P + id));
        return v && typeof v.text === 'string' ? v : null;
      } catch { return null; }
    },
    set(id, text, base = '') {
      try {
        const key = String(id);
        const idx = readIndex();
        if (!idx.includes(key)) storage.setItem(INDEX, JSON.stringify([...idx, key])); // index first: no orphans
        storage.setItem(P + key, JSON.stringify({ text, base, savedAt: Date.now() }));
      } catch { /* best effort */ }
    },
    remove(id) {
      try { storage.removeItem(P + id); } catch { /* best effort */ }
    },
    clear() {
      try {
        for (const id of readIndex()) storage.removeItem(P + id);
        storage.removeItem(INDEX);
      } catch { /* best effort */ }
    },
  };
}
