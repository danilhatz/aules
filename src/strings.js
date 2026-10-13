import { en } from './lang/en.js';
import { uk } from './lang/uk.js';
import { resolveLanguage, readPreference, deviceStorage, localeFor } from './i18n.js';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Returns a new object: `base` with every key that `over` also defines replaced (nested groups merged key by key).
function merge(base, over) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = isObject(v) ? merge(v, isObject(over && over[k]) ? over[k] : {}) : (over && typeof over[k] === 'string' && over[k] ? over[k] : v);
  }
  return out;
}

export function buildStrings(lang, packs = { en, uk }) {
  return lang === 'en' || !packs[lang] ? merge(packs.en, {}) : merge(packs.en, packs[lang]);
}

const phone = globalThis.navigator && globalThis.navigator.languages;
export const LANG = resolveLanguage(readPreference(deviceStorage()), Array.isArray(phone) ? phone : []);
export const STRINGS = buildStrings(LANG);
export const LOCALE = localeFor(LANG, phone);
