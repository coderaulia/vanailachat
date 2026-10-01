import { Agent, ProxyAgent } from 'undici';
import { DatabaseService } from './database.js';

let cachedAgent: ProxyAgent | Agent | null = null;
let lastProxyUrl: string | undefined = undefined;

function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name.endsWith('.localhost') || name === '::1' || /^127\./.test(name);
}

/**
 * Whether `url` must skip the proxy: loopback addresses always (a local Ollama,
 * LM Studio or 9Router is never behind the proxy), plus whatever NO_PROXY lists
 * (`*`, `example.com`, `.example.com`, `host:port`).
 */
export function shouldBypassProxy(url: string, noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ''): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLoopbackHost(host)) return true;

  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return noProxy
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === '*') return true;
      const [entryHost, entryPort] = entry.split(/:(?=\d+$)/);
      if (entryPort && entryPort !== port) return false;
      const bare = entryHost.replace(/^\*?\./, '');
      return host === bare || host.endsWith(`.${bare}`);
    });
}

function createDirectAgent(): Agent {
  return new Agent({ connect: { autoSelectFamily: false, family: 4 } });
}

let directAgent: Agent | null = null;

export function getDispatcher(url?: string): ProxyAgent | Agent {
  if (url && shouldBypassProxy(url)) {
    directAgent ??= createDirectAgent();
    return directAgent;
  }
  let proxy: string | undefined;
  try {
    proxy =
      DatabaseService.getSetting('http_proxy') ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy;
  } catch {
    proxy =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy;
  }

  if (proxy && proxy.trim()) {
    const trimmed = proxy.trim();
    if (cachedAgent instanceof ProxyAgent && lastProxyUrl === trimmed) {
      return cachedAgent;
    }
    lastProxyUrl = trimmed;
    cachedAgent = new ProxyAgent(trimmed);
    return cachedAgent;
  }

  if (cachedAgent instanceof Agent && !(cachedAgent instanceof ProxyAgent)) {
    return cachedAgent;
  }

  lastProxyUrl = undefined;
  cachedAgent = createDirectAgent();
  return cachedAgent;
}

/**
 * Universal backend fetch that automatically routes outbound HTTPS/HTTP requests
 * through any system proxy configured in the environment or enforces single-stack IPv4
 * connections, completely preventing internalConnectMultiple ETIMEDOUT socket hangs.
 */
export async function appFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const dispatcher = getDispatcher(target);
  return globalThis.fetch(input, {
    ...init,
    ...({ dispatcher } as unknown as Record<string, unknown>),
  });
}
