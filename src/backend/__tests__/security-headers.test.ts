import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

function app() {
  return createApp({
    listProjects: () => [],
    createProject: () => {
      throw new Error('boom: /absolute/path/leaked.sqlite');
    },
  });
}

describe('security headers', () => {
  it('sets CSP, frame, sniffing and referrer headers', async () => {
    const response = await app().request('/api/health');

    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('omits HSTS unless ENABLE_HSTS=1', async () => {
    const response = await app().request('/api/health');
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });
});

describe('CORS', () => {
  it('does not echo a wildcard origin', async () => {
    const response = await app().request('/api/health');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('allows a loopback origin', async () => {
    const response = await app().request('/api/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('refuses a foreign origin', async () => {
    const response = await app().request('/api/health', {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('origin guard', () => {
  it('blocks writes from a foreign origin', async () => {
    const response = await app().request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'pwned' }),
    });
    expect(response.status).toBe(403);
  });

  it('blocks writes marked cross-site by the browser', async () => {
    const response = await app().request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ name: 'pwned' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows reads regardless of origin', async () => {
    const response = await app().request('/api/projects', {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(200);
  });

  it('allows non-browser clients that send neither header', async () => {
    const response = await app().request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ok' }),
    });
    expect(response.status).not.toBe(403);
  });
});

describe('error sanitizing', () => {
  it('returns the real message outside production', async () => {
    const response = await app().request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });

    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(500);
    expect(body.error).toContain('leaked.sqlite');
  });

  it('hides internals under NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const response = await app().request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      });

      const body = (await response.json()) as { error: string };
      expect(response.status).toBe(500);
      expect(body.error).not.toContain('leaked.sqlite');
      expect(body.error).toBe('Unknown error');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
