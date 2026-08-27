import { Agent, ProxyAgent } from 'undici';
import { DatabaseService } from './database.js';

let cachedAgent: ProxyAgent | Agent | null = null;
let lastProxyUrl: string | undefined = undefined;

export function getDispatcher(): ProxyAgent | Agent {
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
  cachedAgent = new Agent({
    connect: {
      autoSelectFamily: false,
      family: 4,
    },
  });
  return cachedAgent;
}

/**
 * Universal backend fetch that automatically routes outbound HTTPS/HTTP requests
 * through any system proxy configured in the environment or enforces single-stack IPv4
 * connections, completely preventing internalConnectMultiple ETIMEDOUT socket hangs.
 */
export async function appFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const dispatcher = getDispatcher();
  return globalThis.fetch(input, {
    ...init,
    ...({ dispatcher } as unknown as Record<string, unknown>),
  });
}
