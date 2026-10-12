const P = 'aules.cache.';
const INDEX = P + '__index';

export function createCache(storage) {
  const readIndex = () => {
    try { return JSON.parse(storage.getItem(INDEX)) || []; } catch { return []; }
  };
  return {
    get(key) {
      try { return JSON.parse(storage.getItem(P + key)); } catch { return null; }
    },
    set(key, data) {
      try {
        // Index first: if the data write then fails, nothing is orphaned that clear() cannot find.
        const idx = readIndex();
        if (!idx.includes(key)) storage.setItem(INDEX, JSON.stringify([...idx, key]));
        storage.setItem(P + key, JSON.stringify({ data, savedAt: Date.now() }));
      } catch { /* quota or storage unavailable: caching is best-effort */ }
    },
    clear() {
      for (const key of readIndex()) storage.removeItem(P + key);
      storage.removeItem(INDEX);
    },
  };
}
