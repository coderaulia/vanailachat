import { describe, expect, it } from 'vitest';
import { shouldBypassProxy } from '../services/httpClient.js';

describe('shouldBypassProxy', () => {
  it('never proxies loopback addresses', () => {
    for (const url of ['http://localhost:11434/api', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/', 'http://app.localhost/']) {
      expect(shouldBypassProxy(url, ''), url).toBe(true);
    }
  });

  it('proxies other hosts unless NO_PROXY lists them', () => {
    expect(shouldBypassProxy('https://api.openai.com/v1', '')).toBe(false);
    expect(shouldBypassProxy('https://api.openai.com/v1', 'internal.corp, .example.com')).toBe(false);
    expect(shouldBypassProxy('http://router.internal.corp/v1', 'internal.corp')).toBe(true);
    expect(shouldBypassProxy('https://api.example.com', '.example.com')).toBe(true);
    expect(shouldBypassProxy('https://example.com', '*.example.com')).toBe(true);
    expect(shouldBypassProxy('https://anything.test', '*')).toBe(true);
    expect(shouldBypassProxy('http://box.lan:9000/', 'box.lan:9000')).toBe(true);
    expect(shouldBypassProxy('http://box.lan:9001/', 'box.lan:9000')).toBe(false);
  });

  it('does not match a host that merely ends with the same letters', () => {
    expect(shouldBypassProxy('https://notinternal.corp', 'internal.corp')).toBe(false);
  });

  it('treats an unparseable url as proxied', () => {
    expect(shouldBypassProxy('not a url', '*')).toBe(false);
  });
});
