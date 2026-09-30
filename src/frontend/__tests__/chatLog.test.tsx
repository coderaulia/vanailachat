// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as ChatContext from '../context/ChatContext';
import { ChatLog } from '../components/ChatLog';
import { MAX_CONVERSATION_HISTORY } from '../config/constants';
import type { Message } from '../types/chat';

type ChatValue = ReturnType<typeof ChatContext.useChat>;

const escape = (value: string) => value.replace(/</g, '&lt;');
const renderMarkdown = (content: string) => `<p>${escape(content)}</p>`;

function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, timestamp: 1 };
}

function mockChat(conversation: Message[], overrides: Partial<Record<string, unknown>> = {}) {
  const value = {
    conversation,
    isCurrentChatSending: false,
    handleRegenerate: vi.fn(),
    handleEditAndResend: vi.fn(),
    selectedModel: 'ollama:llama3',
    ...overrides,
  };
  vi.spyOn(ChatContext, 'useChat').mockReturnValue(value as unknown as ChatValue);
  return value;
}

describe('ChatLog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the empty state', () => {
    mockChat([]);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    expect(screen.getByText('No messages yet')).toBeDefined();
  });

  it('renders messages through the markdown renderer', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ feedback: null })));
    mockChat([message('u1', 'user', 'question'), message('a1', 'assistant', 'answer')]);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    expect(screen.getByText('question')).toBeDefined();
    expect(screen.getByText('answer')).toBeDefined();
  });

  it('marks where older messages stop being sent to the model', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ feedback: null })));
    const many = Array.from({ length: MAX_CONVERSATION_HISTORY + 2 }, (_, i) => message(`m${i}`, 'user', `msg ${i}`));
    mockChat(many);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    expect(screen.getByRole('separator').textContent).toContain(`last ${MAX_CONVERSATION_HISTORY}`);
  });

  it('regenerates an assistant answer', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ feedback: null })));
    const chat = mockChat([message('u1', 'user', 'q'), message('a1', 'assistant', 'a')]);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    fireEvent.click(screen.getByTitle('Regenerate this answer'));
    expect(chat.handleRegenerate).toHaveBeenCalledWith('a1');
  });

  it('edits a user message and sends it again', () => {
    const chat = mockChat([message('u1', 'user', 'first draft')]);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    fireEvent.click(screen.getByTitle('Edit this message and ask again'));
    fireEvent.change(screen.getByDisplayValue('first draft'), { target: { value: 'second draft' } });
    fireEvent.click(screen.getByText('Send again'));
    expect(chat.handleEditAndResend).toHaveBeenCalledWith('u1', 'second draft');
  });

  it('saves a thumbs-up and rolls it back if the request fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ feedback: null }));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChat([message('u1', 'user', 'q'), message('a1', 'assistant', 'a')]);
    render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);

    const up = screen.getByTitle('Helpful — train the model on this answer');
    fireEvent.click(up);
    expect(fetchSpy).toHaveBeenCalledWith('/api/messages/a1/feedback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ rating: 1 }) }));
    // Optimistically pressed, then released once the save fails.
    expect(screen.getByTitle('Remove thumbs up').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => {
      const button = screen.getByTitle('Helpful — train the model on this answer');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('shows a loading placeholder until the first token arrives', () => {
    mockChat([message('u1', 'user', 'q')], { isCurrentChatSending: true });
    const { container } = render(<ChatLog showTokens={false} renderMarkdown={renderMarkdown} />);
    expect(container.querySelector('.message.is-loading')).not.toBeNull();
  });
});
