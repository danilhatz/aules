// Records how long each Aules API call takes (name, milliseconds, approximate response size).
// Kept in memory only; shown in Diagnostics so slow calls can be found on the real device.
export function createTimings({ now = () => globalThis.performance.now(), max = 200 } = {}) {
  let entries = [];
  const size = (value) => {
    try { return JSON.stringify(value).length; } catch { return 0; }
  };
  const record = (entry) => {
    entries.push(entry);
    if (entries.length > max) entries = entries.slice(entries.length - max);
  };
  return {
    wrap(api) {
      const out = {};
      for (const [name, fn] of Object.entries(api)) {
        if (typeof fn !== 'function') { out[name] = fn; continue; }
        out[name] = async (...args) => {
          const start = now();
          try {
            const result = await fn(...args);
            record({ name, ms: Math.round(now() - start), bytes: size(result), failed: false });
            return result;
          } catch (err) {
            record({ name, ms: Math.round(now() - start), bytes: 0, failed: true });
            throw err;
          }
        };
      }
      return out;
    },
    list: () => entries.slice(),
    clear() { entries = []; },
  };
}
