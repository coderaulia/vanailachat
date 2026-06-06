import type { Context, Next } from 'hono';

/**
 * In-memory rate limiter middleware for Hono.
 * Limits requests per sliding window per client IP.
 */

interface RateLimitStore {
  count: number;
  resetAt: number;
}

const stores = new Map<string, RateLimitStore>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, store] of stores) {
    if (now > store.resetAt) {
      stores.delete(key);
    }
  }
}, 300_000).unref();

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Create a Hono rate limiter middleware.
 *
 * Example:
 *   app.use('/api/chat', rateLimiter({ maxRequests: 20, windowMs: 60_000 }));
 */
export function rateLimiter(config: RateLimitConfig) {
  const { maxRequests, windowMs } = config;

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'anonymous';

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
