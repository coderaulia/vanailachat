import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const deps = {
  listProjects: () => [],
  getAllSettings: () => ({ openai_api_key: 'sk-secret' }),
};

function app(accessToken: string | null) {
  return createApp(deps, { accessToken });
}

describe('access token', () => {
  it('is off by default, so localhost use is unchanged', async () => {
    const response = await app(null).request('/api/settings');
    expect(response.status).toBe(200);
    expect(await app(null).request('/api/auth/status').then((r) => r.json())).toEqual({ required: false, authenticated: true });
  });

  it('rejects API calls without the token', async () => {
    const response = await app('s3cret').request('/api/settings');
    expect(response.status).toBe(401);
  });

  it('keeps health and status public', async () => {
    const server = app('s3cret');
    expect((await server.request('/api/health')).status).toBe(200);
    expect(await server.request('/api/auth/status').then((r) => r.json())).toEqual({ required: true, authenticated: false });
  });

  it('accepts a Bearer header', async () => {
    const response = await app('s3cret').request('/api/settings', { headers: { authorization: 'Bearer s3cret' } });
    expect(response.status).toBe(200);
  });

  it('rejects a wrong token at sign-in', async () => {
    const response = await app('s3cret').request('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('signs in with an HttpOnly SameSite=Strict cookie that then authorizes requests', async () => {
    const server = app('s3cret');
    const signIn = await server.request('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 's3cret' }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const response = await server.request('/api/settings', { headers: { cookie: cookie.split(';')[0] } });
    expect(response.status).toBe(200);
  });

  it('allows same-origin writes from a LAN address only when a token is configured', async () => {
    const lanWrite = {
      method: 'POST',
      headers: {
        origin: 'http://192.168.1.20:5173',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        authorization: 'Bearer s3cret',
      },
      body: JSON.stringify({ token: 's3cret' }),
    };
    expect((await app('s3cret').request('/api/auth', lanWrite)).status).toBe(200);
    expect((await app(null).request('/api/auth', lanWrite)).status).toBe(403);
  });

  it('still blocks cross-site writes when a token is configured', async () => {
    const response = await app('s3cret').request('/api/auth', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 's3cret' }),
    });
    expect(response.status).toBe(403);
  });
});
