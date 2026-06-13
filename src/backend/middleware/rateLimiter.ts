import type { Context, Next } from 'hono';

/**
 * In-memory rate limiter middleware for Hono.
 * Limits requests per sliding window per client IP.
 */

interface RateLimitStore {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /**
   * Trust the X-Forwarded-For / X-Real-IP request headers for client identity.
   * Default false (uses a single anonymous bucket if no socket-level IP is
   * exposed by the framework). Only enable when behind a trusted reverse
   * proxy that strips inbound forwarding headers — otherwise the client can
   * spoof the header to evade the limit.
   */
  trustProxy?: boolean;
}

/**
 * Create a Hono rate limiter middleware.
 * Each call creates an isolated store so different routes don't share counts.
 *
 * Example:
 *   app.use('/api/chat', rateLimiter({ maxRequests: 20, windowMs: 60_000 }));
 */
export function rateLimiter(config: RateLimitConfig) {
  const { maxRequests, windowMs, trustProxy = false } = config;

  const stores = new Map<string, RateLimitStore>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, store] of stores) {
      if (now > store.resetAt) {
        stores.delete(key);
      }
    }
  }, 300_000).unref();

  return async (c: Context, next: Next) => {
    const ip = trustProxy
      ? (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
         c.req.header('x-real-ip') ??
         'anonymous')
      : 'anonymous';

    const now = Date.now();
    let store = stores.get(ip);

    if (!store || now > store.resetAt) {
      store = { count: 0, resetAt: now + windowMs };
      stores.set(ip, store);
    }

    store.count++;

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - store.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(store.resetAt / 1000)));

    if (store.count > maxRequests) {
      return c.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((store.resetAt - now) / 1000),
        },
        429,
      );
    }

    await next();
  };
}
