import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { readPreference, savePreference, deviceStorage } from '../i18n.js';

export function renderLangSwitch({ storage = deviceStorage(), reload = () => globalThis.location.reload() } = {}) {
  const current = readPreference(storage);
  const option = (value, label) => h('option', { value, selected: value === current }, label);
  const select = h('select', {
    'aria-label': S.language,
    onchange: () => {
      if (savePreference(storage, select.value)) reload(); // reload only when the choice was really stored
    },
  }, option('auto', S.langAuto), option('en', S.langEn), option('uk', S.langUk));
  select.value = current;
  return h('label', { class: 'lang-switch' }, h('span', {}, S.language), select);
}
