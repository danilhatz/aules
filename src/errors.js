import { STRINGS as S } from './strings.js';

export function describeError(err) {
  const code = err && err.code;
  if (code && S.errors[code]) return S.errors[code];
  return code ? `${S.errors.unknown} (${code})` : S.errors.unknown;
}
