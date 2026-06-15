import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';

const message = {
  id: 'msg_1',
  chatId: 'chat_1',
  role: 'assistant',
  content: 'hello',
  promptTokens: null,
  completionTokens: null,
  createdAt: Date.now(),
};

describe('message feedback', () => {
  it('POST /api/messages/:id/feedback writes rating', async () => {
    const getMessage = vi.fn().mockReturnValue(message);
    const upsertFeedback = vi.fn().mockReturnValue({
      messageId: 'msg_1', rating: 1, editedContent: null,
      createdAt: 1, updatedAt: 1,
    });
    const app = createApp({ getMessage, upsertFeedback });

    const response = await app.request('/api/messages/msg_1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1 }),
    });

    expect(response.status).toBe(200);
    expect(upsertFeedback).toHaveBeenCalledWith({
      messageId: 'msg_1', rating: 1, editedContent: null,
    });
  });

  it('POST /api/messages/:id/feedback accepts editedContent', async () => {
    const getMessage = vi.fn().mockReturnValue(message);
    const upsertFeedback = vi.fn().mockReturnValue({
      messageId: 'msg_1', rating: 1, editedContent: 'better answer',
      createdAt: 1, updatedAt: 1,
    });
    const app = createApp({ getMessage, upsertFeedback });

    const response = await app.request('/api/messages/msg_1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1, editedContent: 'better answer' }),
    });

    expect(response.status).toBe(200);
    expect(upsertFeedback.mock.calls[0][0].editedContent).toBe('better answer');
  });

  it('POST /api/messages/:id/feedback rejects missing rating', async () => {
    const getMessage = vi.fn().mockReturnValue(message);
    const upsertFeedback = vi.fn();
    const app = createApp({ getMessage, upsertFeedback });

    const response = await app.request('/api/messages/msg_1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(upsertFeedback).not.toHaveBeenCalled();
  });

  it('POST /api/messages/:id/feedback returns 404 for missing message', async () => {
    const getMessage = vi.fn().mockReturnValue(null);
    const upsertFeedback = vi.fn();
    const app = createApp({ getMessage, upsertFeedback });

    const response = await app.request('/api/messages/missing/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1 }),
    });

    expect(response.status).toBe(404);
    expect(upsertFeedback).not.toHaveBeenCalled();
  });

  it('GET /api/messages/:id/feedback returns current rating', async () => {
    const feedback = {
      messageId: 'msg_1', rating: -1, editedContent: null,
      createdAt: 1, updatedAt: 1,
    };
    const getFeedback = vi.fn().mockReturnValue(feedback);
    const app = createApp({ getFeedback });

    const response = await app.request('/api/messages/msg_1/feedback');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { feedback: typeof feedback };
    expect(body.feedback).toEqual(feedback);
  });
});
