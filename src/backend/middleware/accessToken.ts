import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export const ACCESS_COOKIE = 'vanaila_access';

/** Endpoints reachable without a token: liveness checks and the sign-in route. */
const PUBLIC_PATHS = new Set(['/api/health', '/api/hello', '/api/auth', '/api/auth/status']);

function sameToken(given: string, expected: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function presentedToken(authorization: string | undefined, cookie: string | undefined): string | null {
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return cookie ?? null;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Optional shared-secret gate for running the API beyond localhost.
 *
 * Off unless VANAILA_ACCESS_TOKEN is set. When on, every /api request other
 * than PUBLIC_PATHS needs the token as a Bearer header or the HttpOnly cookie
 * set by POST /api/auth. The cookie is SameSite=Strict, so a cross-site page
 * cannot ride on it.
 */
export function accessToken(token: string): MiddlewareHandler {
  return async function accessTokenMiddleware(context, next) {
    if (!context.req.path.startsWith('/api/') || PUBLIC_PATHS.has(context.req.path)) {
      return next();
    }
    const given = presentedToken(context.req.header('authorization'), getCookie(context, ACCESS_COOKIE));
    if (!given || !sameToken(given, token)) {
      return context.json({ error: 'Access token required' }, 401);
    }
    return next();
  };
}

/** Sign-in and status routes used by the browser when a token is configured. */
export function registerAccessRoutes(app: Hono, token: string | null): void {
  app.get('/api/auth/status', (context) => {
    if (!token) return context.json({ required: false, authenticated: true });
    const given = presentedToken(context.req.header('authorization'), getCookie(context, ACCESS_COOKIE));
    return context.json({ required: true, authenticated: Boolean(given && sameToken(given, token)) });
  });

  app.post('/api/auth', async (context) => {
    if (!token) return context.json({ ok: true });
    const body = (await context.req.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== 'string' || !sameToken(body.token, token)) {
      return context.json({ error: 'Invalid access token' }, 401);
    }
    setCookie(context, ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return context.json({ ok: true });
  });
}
