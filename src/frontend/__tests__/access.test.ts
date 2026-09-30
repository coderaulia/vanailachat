// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAccess } from '../lib/access';

function mockFetch(status: { required: boolean; authenticated: boolean } | 'down') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (status === 'down') throw new Error('offline');
    if (url === '/api/auth') return new Response(JSON.stringify({ ok: true }));
    return new Response(JSON.stringify(status));
  });
}

describe('ensureAccess', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('lets the app load when no token is required', async () => {
    mockFetch({ required: false, authenticated: true });
    expect(await ensureAccess()).toBe(true);
  });

  it('asks for a token when the server requires one', async () => {
    mockFetch({ required: true, authenticated: false });
    expect(await ensureAccess()).toBe(false);
  });

  it('signs in from a ?token= link and removes it from the address bar', async () => {
    window.history.replaceState(null, '', '/?token=abc&x=1#top');
    const fetchSpy = mockFetch({ required: true, authenticated: true });
    expect(await ensureAccess()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth', expect.objectContaining({ body: JSON.stringify({ token: 'abc' }) }));
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#top');
  });

  it('does not block the app when the backend is unreachable', async () => {
    mockFetch('down');
    expect(await ensureAccess()).toBe(true);
  });
});
