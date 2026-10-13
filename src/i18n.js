export const LANGUAGES = ['en', 'uk'];
export const PREF_KEY = 'aules.lang';

export function resolveLanguage(pref, navigatorLanguages) {
  if (LANGUAGES.includes(pref)) return pref;
  if (Array.isArray(navigatorLanguages)) {
    for (const tag of navigatorLanguages) {
      if (typeof tag !== 'string') continue;
      const primary = tag.toLowerCase().split('-')[0];
      if (LANGUAGES.includes(primary)) return primary;
    }
  }
  return 'en';
}

export function readPreference(storage) {
  try {
    const v = storage && storage.getItem(PREF_KEY);
    return LANGUAGES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function savePreference(storage, value) {
  if (!storage || (value !== 'auto' && !LANGUAGES.includes(value))) return false;
  try {
    if (value === 'auto') storage.removeItem(PREF_KEY);
    else storage.setItem(PREF_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function deviceStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// The language for dates and relative times: the phone's own regional tag (en-GB, uk-UA) when it matches the app language, else the bare code.
export function localeFor(lang, navigatorLanguages) {
  if (Array.isArray(navigatorLanguages)) {
    for (const tag of navigatorLanguages) {
      if (typeof tag !== 'string' || tag.toLowerCase().split('-')[0] !== lang) continue;
      try { return Intl.getCanonicalLocales(tag)[0]; } catch { /* malformed tag: ignore */ }
    }
  }
  return lang;
}
