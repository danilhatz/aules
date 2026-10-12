import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { sanitizeHtml, isSafeHttpUrl } from '../src/sanitize.js';

setupDom();

test('keeps safe formatting', () => {
  assert.equal(sanitizeHtml('<p>Hi <strong>there</strong></p>'), '<p>Hi <strong>there</strong></p>');
});

test('drops script/style/svg/iframe/form content entirely', () => {
  const out = sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{}</style><svg onload="x()"><circle/></svg><iframe src="https://e.com"></iframe><form><input></form>');
  assert.equal(out, '<p>a</p>');
});

test('strips event handlers and style attributes', () => {
  const out = sanitizeHtml('<p style="color:red" onclick="x()">a</p><img src="https://e.com/i.png" onerror="alert(1)">');
  assert.ok(!/onclick|onerror|style=/i.test(out));
  assert.ok(out.includes('<img'));
});

test('removes javascript: URLs including tab-obfuscated ones, keeps link text', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">one</a><a href="jav&#x09;ascript:alert(2)">two</a>');
  assert.ok(!/javascript/i.test(out));
  assert.ok(out.includes('one') && out.includes('two'));
});

test('drops data: image sources but keeps https ones', () => {
  const out = sanitizeHtml('<img src="data:image/svg+xml;base64,AAAA"><img src="https://e.com/a.png">');
  assert.ok(!out.includes('data:'));
  assert.ok(out.includes('https://e.com/a.png'));
});

test('unknown wrapper tags are unwrapped, comments removed', () => {
  assert.equal(sanitizeHtml('<font color="red">text</font><!-- c -->'), 'text');
});

test('links open safely in a new tab', () => {
  const out = sanitizeHtml('<a href="https://e.com/x">x</a>');
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('rewriteUrl is applied to surviving href and src only', () => {
  const out = sanitizeHtml('<a href="https://e.com/a">a</a><img src="https://e.com/i.png"><a href="javascript:x">b</a>', {
    rewriteUrl: (u) => u + '?T=1',
  });
  assert.ok(out.includes('href="https://e.com/a?T=1"'));
  assert.ok(out.includes('src="https://e.com/i.png?T=1"'));
});

test('isSafeHttpUrl accepts only absolute http(s)', () => {
  assert.equal(isSafeHttpUrl('https://a.com/x'), true);
  assert.equal(isSafeHttpUrl('http://a.com'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('/relative'), false);
  assert.equal(isSafeHttpUrl('data:text/html,x'), false);
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl(undefined), false);
});
