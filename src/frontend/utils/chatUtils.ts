import type { MessageRole, Message, StreamEvent } from '../types/chat';
import type { ModelRole } from '../config/modelRoles';

export function toMessageRole(role: string): MessageRole {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  return 'assistant';
}

export function toModelRole(role: string | null | undefined): ModelRole {
  if (role === 'general' || role === 'coding' || role === 'vision' || role === 'content') {
    return role;
  }
  return 'general';
}

export function parseUsage(data: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }): number {
  if (typeof data.total_tokens === 'number') {
    return data.total_tokens;
  }
  const promptTokens = data.prompt_tokens ?? 0;
  const completionTokens = data.completion_tokens ?? 0;
  return promptTokens + completionTokens;
}

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return null;
  }
}

export function applyStreamEvent(prev: Message[], event: StreamEvent): Message[] {
  const content = event.message?.content || '';
  const usage = event.usage ? parseUsage(event.usage) : 0;
  
  const lastMessage = prev[prev.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    const updated = [...prev];
    updated[updated.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + content,
      completionTokens: (lastMessage.completionTokens || 0) + (event.eval_count || usage || 0),
    };
    return updated;
  } else {
    return [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: content,
        timestamp: Date.now(),
        completionTokens: event.eval_count || usage || 0,
      },
    ];
  }
}
