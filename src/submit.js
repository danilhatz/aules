import { MoodleError } from './api.js';
import { withToken } from './content.js';
import { buildPlugindata } from './assign.js';

const PROPAGATE = new Set(['network', 'retry', 'invalidtoken']);

async function draftItemId(write, api) {
  try {
    const r = await write((s) => api.getUnusedDraftItemId(s.token));
    return r && r.itemid != null ? r.itemid : 0;
  } catch (e) {
    if (e && PROPAGATE.has(e.code)) throw e;
    return 0;
  }
}

async function buildFileDraft({ api, write, keep, added, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const queue = [];
  for (const f of keep) {
    const blob = await write(async (s) => {
      let res;
      try {
        res = await doFetch(withToken(f.url, s.token), { credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch {
        throw new MoodleError('keepfailed');
      }
      if (!res.ok) throw new MoodleError('keepfailed');
      return res.blob();
    });
    queue.push({ name: f.name, blob });
  }
  for (const f of added) queue.push({ name: f.name, blob: f });
  if (!queue.length) return draftItemId(write, api);
  let itemid = 0;
  for (const f of queue) {
    const r = await write((s) => api.uploadDraftFile(s.token, f, { itemid }));
    itemid = r.itemid;
  }
  return itemid;
}

export async function performSubmission({ api, write, assignment, input, fetchImpl }) {
  const files = input.files || { changed: false, keep: [], added: [] };
  const wantsSubmit = Boolean(input.submit);
  if (!input.textChanged && !files.changed && wantsSubmit && !assignment.drafts) throw new MoodleError('nochanges');

  // Everything that can fail before anything is written happens first.
  const textItemId = input.textChanged ? await draftItemId(write, api) : undefined;
  const filesItemId = files.changed
    ? await buildFileDraft({ api, write, keep: files.keep, added: files.added, fetchImpl })
    : undefined;

  const plugindata = buildPlugindata({
    text: input.text, textChanged: input.textChanged, textItemId, filesChanged: files.changed, filesItemId,
  });
  const saved = Object.keys(plugindata).length > 0;
  if (saved) await write((s) => api.saveSubmission(s.token, assignment.id, plugindata));
  if (wantsSubmit && assignment.drafts) {
    await write((s) => api.submitForGrading(s.token, assignment.id, Boolean(input.acceptStatement)));
  }
  return { saved, submitted: wantsSubmit };
}
