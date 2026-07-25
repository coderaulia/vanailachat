import type { MiddlewareHandler } from 'hono';

/** Loopback origins on any port — the only browser origins allowed to drive this API. */
export const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request guard for state-changing requests.
 *
 * CORS decides who may *read* a response; it does not stop the request from
 * being sent. That matters here because the API exposes filesystem and shell
 * tools, so a page the user happens to have open must not be able to POST to it.
 *
 * Policy: if the request carries browser provenance headers (`Origin` or
 * `Sec-Fetch-Site`), they must indicate a loopback/same-origin caller. Requests
 * with neither header are not browser-initiated — curl, the test suite, a native
 * client — and are allowed through, since a browser cannot suppress both.
 */
export function originGuard(): MiddlewareHandler {
  return async function originGuardMiddleware(context, next) {
    if (SAFE_METHODS.has(context.req.method)) {
      return next();
    }

    const origin = context.req.header('origin');
    if (origin !== undefined && !LOOPBACK_ORIGIN.test(origin)) {
      return context.json({ error: 'Cross-origin request blocked' }, 403);
    }

    const secFetchSite = context.req.header('sec-fetch-site');
    if (secFetchSite !== undefined && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return context.json({ error: 'Cross-site request blocked' }, 403);
    }

    return next();
  };
}
