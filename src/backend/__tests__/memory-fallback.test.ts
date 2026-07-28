import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { OllamaService } from '../services/ollama.js';
import { EmbeddingService } from '../services/embedding.js';
import { DatabaseService } from '../services/database.js';

const entries = [
  {
    id: 'mem_1',
    type: 'conversation',
    content: 'Parental leave policy gives 16 weeks paid for primary caregivers',
    embedding: '',
    metadata: null,
    sourceId: null,
    createdAt: Date.now(),
  },
  {
    id: 'mem_2',
    type: 'conversation',
    content: 'The office espresso machine is on the third floor',
    embedding: '',
    metadata: null,
    sourceId: null,
    createdAt: Date.now(),
  },
];

describe('keyword memory fallback', () => {
  beforeEach(() => {
    vi.spyOn(DatabaseService, 'getAllMemoryEntries').mockReturnValue(entries);
  });

  it('recalls by token overlap when no embedding backend exists', () => {
    const results = EmbeddingService.searchByKeyword('what is our parental leave policy?', 3, 0.2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('Parental leave policy');
  });

  it('ignores entries that share no meaningful tokens', () => {
    const results = EmbeddingService.searchByKeyword('parental leave policy', 5, 0.2);
    expect(results.map((r) => r.id)).not.toContain('mem_2');
  });

  it('returns nothing for a query of only stopwords', () => {
    expect(EmbeddingService.searchByKeyword('what is the', 5, 0.2)).toEqual([]);
  });

  it('falls back to keyword search inside search()', async () => {
    vi.spyOn(EmbeddingService, 'embedOrNull').mockResolvedValue(null);

    const results = await EmbeddingService.search('parental leave policy', 3, 0.3);
    expect(results[0]?.content).toContain('Parental leave policy');
  });
});

describe('memory storage without an embedding backend', () => {
  beforeEach(() => {
    vi.spyOn(OllamaService, 'getInstalledModels').mockResolvedValue(['llama3']);
  });

  it('still stores the user message and injects keyword recall', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );
    const upsertMemory = vi.fn();

    const app = createApp({
      fetchFn: fetchMock,
      getBaseUrl: () => 'http://ollama.local',
      getInstalledModels: async () => ['llama3'],
      getModelDetails: async () => ({ capabilities: ['chat'] }),
      listEnabledSkills: () => [],
      getSetting: () => null,
      // No embedding backend reachable.
      embedOrNull: async () => null,
      searchMemoriesByKeyword: () => [
        { id: 'mem_1', content: 'Parental leave is 16 weeks paid', score: 0.8, metadata: null },
      ],
      upsertMemory: upsertMemory as never,
    });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'remind me how much parental leave we offer' }],
        stream: true,
      }),
    });
    await response.text();

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    // Recall reached the prompt...
    expect(body.messages[0].content).toContain('[Relevant Memories]');
    expect(body.messages[0].content).toContain('Parental leave is 16 weeks paid');

    // ...and the turn was still stored, with a null vector rather than skipped.
    expect(upsertMemory).toHaveBeenCalledTimes(1);
    expect(upsertMemory.mock.calls[0][0]).toMatchObject({
      embedding: null,
      content: 'remind me how much parental leave we offer',
    });
  });
});
