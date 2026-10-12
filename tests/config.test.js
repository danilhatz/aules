import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_URL, SERVICE } from '../src/config.js';
import { STRINGS } from '../src/strings.js';

test('config points at aules over https with no trailing slash', () => {
  assert.equal(SITE_URL, 'https://aules.edu.gva.es/fpa');
  assert.equal(SERVICE, 'moodle_mobile_app');
});

test('strings define every error code the UI can show', () => {
  for (const k of ['invalidlogin', 'invalidtoken', 'network', 'badresponse', 'notoken', 'servicenotavailable', 'unknown']) {
    assert.ok(STRINGS.errors[k], k);
  }
});
