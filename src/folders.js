const KEY = 'aules.folders';

export function createFolderState(storage) {
  const read = () => {
    try { return JSON.parse(storage.getItem(KEY)) || {}; } catch { return {}; }
  };
  return {
    get(name) {
      const v = read()[name];
      return typeof v === 'boolean' ? v : undefined;
    },
    set(name, open) {
      try { storage.setItem(KEY, JSON.stringify({ ...read(), [name]: Boolean(open) })); } catch { /* best effort */ }
    },
  };
}
