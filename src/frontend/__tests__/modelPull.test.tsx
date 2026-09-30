// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiPullModel } from '../lib/api';
import * as api from '../lib/api';
import { ModelPull } from '../components/settings/ModelPull';
import { summarizeChatUsage } from '../config/modelPricing';

function streamOf(lines: object[]): Response {
  // Split mid-line to prove partial chunks are reassembled.
  const text = lines.map((line) => JSON.stringify(line)).join('\n');
  const cut = Math.floor(text.length / 2);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, cut)));
      controller.enqueue(encoder.encode(text.slice(cut)));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('apiPullModel (web)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports every progress line, including one split across chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf([
      { status: 'pulling manifest' },
      { status: 'pulling abc', completed: 5, total: 10 },
      { status: 'success' },
    ]));
    const seen: string[] = [];
    await apiPullModel('llama3', (p) => seen.push(p.status ?? ''));
    expect(seen).toEqual(['pulling manifest', 'pulling abc', 'success']);
  });

  it('fails when Ollama sends an error line', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf([{ error: 'pull model manifest: file does not exist' }]));
    await expect(apiPullModel('nope')).rejects.toThrow(/does not exist/);
  });

  it('surfaces a rejected name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'A valid model name is required' }), { status: 400 }));
    await expect(apiPullModel('../x')).rejects.toThrow(/valid model name/);
  });
});

describe('ModelPull', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows download progress, then success, and refreshes the model list', async () => {
    let report: ((p: api.PullProgress) => void) | undefined;
    let finish: (() => void) | undefined;
    vi.spyOn(api, 'apiPullModel').mockImplementation((_name, onProgress) => {
      report = onProgress;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const onPulled = vi.fn();
    render(<ModelPull onPulled={onPulled} />);

    fireEvent.change(screen.getByLabelText('Download a model'), { target: { value: 'llama3.2:3b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(report).toBeDefined());

    report!({ status: 'pulling abc123', completed: 1_000_000_000, total: 2_000_000_000 });
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50'));
    expect(screen.getByText(/Downloading 1\.0 GB of 2\.0 GB · 50%/)).toBeDefined();

    finish!();
    await waitFor(() => expect(screen.getByText(/llama3\.2:3b is ready to use/)).toBeDefined());
    expect(onPulled).toHaveBeenCalledOnce();
  });

  it('shows the error when a pull fails', async () => {
    vi.spyOn(api, 'apiPullModel').mockRejectedValue(new Error('Pull failed: file does not exist'));
    render(<ModelPull />);
    fireEvent.change(screen.getByLabelText('Download a model'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toContain('file does not exist');
  });
});

describe('summarizeChatUsage', () => {
  const messages = [{ promptTokens: 1_000_000, completionTokens: 500_000 }, { promptTokens: null, completionTokens: null }, {}];

  it('totals tokens across messages', () => {
    const usage = summarizeChatUsage(messages, 'ollama:llama3');
    expect(usage.promptTokens).toBe(1_000_000);
    expect(usage.completionTokens).toBe(500_000);
    expect(usage.cost).toBeNull();
  });

  it('prices the total when the model has a known rate', () => {
    // gpt-4o: $2.50 in + $10 out per 1M tokens.
    expect(summarizeChatUsage(messages, 'openai:gpt-4o').cost).toBeCloseTo(7.5);
  });
});
