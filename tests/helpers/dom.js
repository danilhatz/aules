import { JSDOM } from 'jsdom';

export function setupDom(html = '<!doctype html><html><body><div id="app"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'https://app.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  return dom;
}
