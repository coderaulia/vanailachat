import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimiter } from '../middleware/rateLimiter';

function buildApp(opts: Parameters<typeof rateLimiter>[0]) {
  const app = new Hono();
  app.use('/limited/*', rateLimiter(opts));
  app.get('/limited/hit', (c) => c.json({ ok: true }));
  return app;
}

describe('rate limiter middleware', () => {
  it('allows requests up to the limit, blocks beyond', async () => {
    const app = buildApp({ maxRequests: 2, windowMs: 10_000 });

    const r1 = await app.request('/limited/hit');
    const r2 = await app.request('/limited/hit');
    const r3 = await app.request('/limited/hit');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);

    const body = (await r3.json()) as { error: string; retryAfter: number };
    expect(body.error).toMatch(/Too many requests/);
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('sets rate limit headers', async () => {
    const app = buildApp({ maxRequests: 5, windowMs: 10_000 });

    const response = await app.request('/limited/hit');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    expect(response.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);
  });

  it('resets after the window expires', async () => {
    vi.useFakeTimers();
    const app = buildApp({ maxRequests: 1, windowMs: 1_000 });

    const first = await app.request('/limited/hit');
    expect(first.status).toBe(200);

    const second = await app.request('/limited/hit');
    expect(second.status).toBe(429);

    vi.advanceTimersByTime(1_500);

    const third = await app.request('/limited/hit');
    expect(third.status).toBe(200);

    vi.useRealTimers();
  });

  it('ignores X-Forwarded-For when trustProxy is false (single bucket)', async () => {
    const app = buildApp({ maxRequests: 1, windowMs: 10_000, trustProxy: false });

    const r1 = await app.request('/limited/hit', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const r2 = await app.request('/limited/hit', { headers: { 'x-forwarded-for': '2.2.2.2' } });

    expect(r1.status).toBe(200);
    // Spoofing X-Forwarded-For does NOT yield a separate bucket
    expect(r2.status).toBe(429);
  });

  it('honors X-Forwarded-For when trustProxy is true', async () => {
    const app = buildApp({ maxRequests: 1, windowMs: 10_000, trustProxy: true });

    const r1 = await app.request('/limited/hit', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const r2 = await app.request('/limited/hit', { headers: { 'x-forwarded-for': '2.2.2.2' } });

    expect(r1.status).toBe(200);
    // Different X-Forwarded-For → separate bucket
    expect(r2.status).toBe(200);
  });
});
