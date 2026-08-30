import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app';
import { DatabaseService } from '../services/database';

describe('A/B route', () => {
  let dbDir: string | null = null;

  afterEach(() => {
    if (dbDir) {
      (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
      (DatabaseService as unknown as { db: unknown }).db = null;
      try {
        if (fs.existsSync(dbDir)) fs.rmSync(dbDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      dbDir = null;
    }
  });
  it('POST /api/ab executes comparison between modelA and modelB', async () => {
    const mockProvider = {
      chat: vi.fn().mockImplementation(async (params: { model: string }) => {
        return {
          choices: [
            {
              message: {
                content: `Response from ${params.model}`,
              },
            },
          ],
        };
      }),
    };

    const providerRegistry = {
      resolveModel: vi.fn().mockImplementation((modelId: string) => ({
        provider: mockProvider,
        modelName: modelId,
      })),
    };

    const app = createApp({ providerRegistry: providerRegistry as unknown as import('../services/providerRegistry').ProviderRegistry });

    const response = await app.request('/api/ab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Explain quantum computing',
        modelA: 'gpt-4o',
        modelB: 'claude-3-5-sonnet',
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { a: { model: string; content: string }; b: { model: string; content: string } };
    expect(body.a.model).toBe('gpt-4o');
    expect(body.a.content).toBe('Response from gpt-4o');
    expect(body.b.model).toBe('claude-3-5-sonnet');
    expect(body.b.content).toBe('Response from claude-3-5-sonnet');
  });

  it('POST /api/ab supports web search grounding', async () => {
    let passedMessages: Array<{ role: string; content: unknown }> = [];
    const mockProvider = {
      chat: vi.fn().mockImplementation(async (params: { model: string; messages: Array<{ role: string; content: unknown }> }) => {
        passedMessages = params.messages;
        return { message: { content: 'Search grounded answer' } };
      }),
    };

    const executeTool = vi.fn().mockResolvedValue('Latest Tech News 2026');
    const providerRegistry = {
      resolveModel: vi.fn().mockReturnValue({ provider: mockProvider, modelName: 'test-model' }),
    };

    const app = createApp({
      providerRegistry: providerRegistry as unknown as import('../services/providerRegistry').ProviderRegistry,
      executeTool,
    });

    const response = await app.request('/api/ab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'What happened today?',
        modelA: 'model-a',
        modelB: 'model-b',
        search: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(executeTool).toHaveBeenCalledWith('search_web', { query: 'What happened today?' }, null);
    expect(passedMessages[0].content).toContain('[Web Search Results]');
    expect(passedMessages[0].content).toContain('Latest Tech News 2026');
  });

  it('POST /api/ab supports deep research and attachments', async () => {
    let userMessageContent: unknown = null;
    let systemMessageContent = '';

    const mockProvider = {
      chat: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        systemMessageContent = params.messages[0].content as string;
        userMessageContent = params.messages[1].content;
        return { message: { content: 'Deep research response' } };
      }),
    };

    const searchMemoriesByText = vi.fn().mockResolvedValue([
      { id: 'mem1', content: 'User prefers concise summaries', score: 0.85 },
    ]);
    const executeTool = vi.fn().mockResolvedValue('Search ground result');
    const providerRegistry = {
      resolveModel: vi.fn().mockReturnValue({ provider: mockProvider, modelName: 'test-model' }),
    };

    const app = createApp({
      providerRegistry: providerRegistry as unknown as import('../services/providerRegistry').ProviderRegistry,
      searchMemoriesByText,
      executeTool,
    });

    const response = await app.request('/api/ab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Analyze attached report',
        modelA: 'model-a',
        modelB: 'model-b',
        deepResearch: true,
        attachments: [
          { type: 'text', name: 'report.txt', content: 'Sales Q3: +15%' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(searchMemoriesByText).toHaveBeenCalledWith('Analyze attached report', 5, 0.25);
    expect(systemMessageContent).toContain('[Relevant Memories]');
    expect(systemMessageContent).toContain('User prefers concise summaries');
    expect(userMessageContent).toContain('[File: report.txt]');
    expect(userMessageContent).toContain('Sales Q3: +15%');
  });

  it('POST /api/ab/pick records winning training pair without 500 errors', async () => {
    const recordAbPick = vi.fn().mockReturnValue({ chatId: 'chat_ab_1', messageId: 'msg_win_1' });
    const app = createApp({ recordAbPick });

    const response = await app.request('/api/ab/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userContent: 'What is SQLite WAL?',
        winnerContent: 'Write-Ahead Logging improves concurrency.',
        winnerModel: 'gpt-4o',
        loserModel: 'llama3:8b',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ chatId: 'chat_ab_1', messageId: 'msg_win_1' });
    expect(recordAbPick).toHaveBeenCalledWith({
      userContent: 'What is SQLite WAL?',
      assistantContent: 'Write-Ahead Logging improves concurrency.',
      winnerModel: 'gpt-4o',
      loserModel: 'llama3:8b',
    });
  });

  it('DatabaseService.recordAbPick creates chat and training pair with default project safely', () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-ab-test-'));
    const testDbPath = path.join(dbDir, 'test.sqlite');
    (DatabaseService as unknown as { db: { close: () => void } | null }).db?.close();
    (DatabaseService as unknown as { db: unknown }).db = null;
    DatabaseService.initialize(testDbPath);

    const result = DatabaseService.recordAbPick({
      userContent: 'test query',
      assistantContent: 'test winner output',
      winnerModel: 'test-model',
    });

    expect(result.chatId).toBeTruthy();
    expect(result.messageId).toBeTruthy();

    const chat = DatabaseService.getChat(result.chatId);
    expect(chat).toBeTruthy();
    expect(chat?.model).toBe('test-model');

    const message = DatabaseService.getMessage(result.messageId);
    expect(message).toBeTruthy();
    expect(message?.content).toBe('test winner output');

    const feedback = DatabaseService.getFeedback(result.messageId);
    expect(feedback).toBeTruthy();
    expect(feedback?.rating).toBe(1);
  });
});
