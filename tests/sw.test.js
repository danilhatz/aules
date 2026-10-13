import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const code = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

// Run sw.js against a fake service-worker global and return its registered handlers.
function load() {
  const listeners = {};
  const store = new Map(); // cache name -> Map(url -> response)
  const fetched = [];
  const added = [];
  const caches = {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        match: async (req) => m.get(typeof req === 'string' ? req : req.url) ?? undefined,
        put: async (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); },
        addAll: async (reqs) => { added.push(...reqs); for (const r of reqs) m.set(r.url ?? r, { shell: true }); },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (k) => store.delete(k),
  };
  const self = { addEventListener: (type, fn) => { listeners[type] = fn; }, location: { origin: 'https://app.test' }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const fakeFetch = async (req) => { fetched.push(typeof req === 'string' ? req : req.url); return { ok: true, fromNetwork: true }; };
  class FakeRequest { constructor(url, init) { this.url = new URL(url, 'https://app.test/aules/').href; this.cache = init && init.cache; } }
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Request', code)(self, caches, fakeFetch, FakeRequest);
  return { listeners, store, fetched, added };
}

const fetchEvent = (url, method = 'GET') => {
  let responded;
  return { request: { url, method }, respondWith: (p) => { responded = p; }, get responded() { return responded; } };
};

test('shell files are cache-first: a cached file is served without any network request', async () => {
  const sw = load();
  const real = code.match(/const VERSION = "([^"]+)"/)[1];
  sw.store.set(`aules-shell-${real}`, new Map([['https://app.test/aules/src/app.js', { ok: true, cached: true }]]));
  const ev = fetchEvent('https://app.test/aules/src/app.js');
  sw.listeners.fetch(ev);
  const res = await ev.responded;
  assert.equal(res.cached, true);
  assert.deepEqual(sw.fetched, []); // no background revalidation competing with Aules calls
});

test('files that are not cached fall back to the network; other origins and non-GET are not touched', async () => {
  const sw = load();
  const miss = fetchEvent('https://app.test/aules/other.txt');
  sw.listeners.fetch(miss);
  assert.equal((await miss.responded).fromNetwork, true);
  const cross = fetchEvent('https://aules.edu.gva.es/fpa/webservice/rest/server.php');
  sw.listeners.fetch(cross);
  assert.equal(cross.responded, undefined);
  const post = fetchEvent('https://app.test/aules/x', 'POST');
  sw.listeners.fetch(post);
  assert.equal(post.responded, undefined);
});

test('install pre-caches every shell file bypassing the HTTP cache so a new version never stores stale files', async () => {
  const sw = load();
  let waited;
  sw.listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  assert.ok(sw.added.length >= 25);
  assert.ok(sw.added.every((r) => r.cache === 'reload'));
});

test('activate removes older caches', async () => {
  const sw = load();
  sw.store.set('aules-shell-old', new Map());
  let waited;
  sw.listeners.activate({ waitUntil: (p) => { waited = p; } });
  await waited;
  const real = code.match(/const VERSION = "([^"]+)"/)[1];
  assert.ok(!sw.store.has('aules-shell-old'));
  assert.ok([...sw.store.keys()].every((k) => k === `aules-shell-${real}`));
});
