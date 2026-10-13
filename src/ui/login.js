import { h } from './dom.js';
import { STRINGS as S } from '../strings.js';
import { describeError } from '../errors.js';
import { renderLangSwitch } from './langswitch.js';

export function renderLogin({ onSubmit, message = '' }) {
  const user = h('input', { id: 'user', name: 'username', type: 'text', inputmode: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', required: true });
  const pass = h('input', { id: 'pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'form-msg', role: 'alert' }, message);
  const btn = h('button', { type: 'submit', class: 'btn' }, S.signIn);
  const form = h('form', {
    class: 'login-card',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.textContent = '';
      try {
        await onSubmit(user.value.trim(), pass.value);
      } catch (err) {
        msg.textContent = describeError(err);
      } finally {
        btn.disabled = false;
        pass.value = '';
      }
    },
  },
  h('h1', {}, S.appName),
  h('label', { for: 'user' }, S.username), user,
  h('label', { for: 'pass' }, S.password), pass,
  msg, h('p', { class: 'muted' }, S.saveNote), btn);
  return h('div', { class: 'login' }, form, renderLangSwitch());
}
