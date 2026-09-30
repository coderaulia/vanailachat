import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { isValidModelName } from '../routes/models.js';

function ndjson(lines: object[]): Response {
  return new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n', {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function pull(app: ReturnType<typeof createApp>, name: unknown) {
  return app.request('/api/models/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

describe('POST /api/models/pull', () => {
  it('streams Ollama progress lines through', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ndjson([
      { status: 'pulling manifest' },
      { status: 'pulling abc', completed: 50, total: 100 },
      { status: 'success' },
    ]));
    const app = createApp({ fetchFn, getBaseUrl: () => 'http://ollama.test' });

    const response = await pull(app, 'llama3.2:3b');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('ndjson');
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ status: 'success' });

    const [url, init] = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/api/pull'))!;
    expect(url).toBe('http://ollama.test/api/pull');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'llama3.2:3b', stream: true });
  });

  it('rejects names that are not Ollama model references', async () => {
    const fetchFn = vi.fn();
    const app = createApp({ fetchFn, getBaseUrl: () => 'http://ollama.test' });
    for (const name of ['', '../etc', 'a b', 'x;rm', 42]) {
      expect((await pull(app, name)).status).toBe(400);
    }
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining('/api/pull'), expect.anything());
  });

  it('reports Ollama being unreachable', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const app = createApp({ fetchFn, getBaseUrl: () => 'http://ollama.test' });
    expect((await pull(app, 'llama3')).status).toBe(502);
  });
});

describe('isValidModelName', () => {
  it('accepts tags and namespaces', () => {
    for (const name of ['llama3', 'llama3.2:3b', 'qwen2.5-coder:7b', 'library/mistral:latest', 'hf.co/org/model:Q4_K_M']) {
      expect(isValidModelName(name)).toBe(true);
    }
  });
});
