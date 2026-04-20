import type { Chat } from '../types/chat';

export const CHAT_STORAGE_KEY = 'chatHistories';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function repairChatHistories(rawValue: unknown): {
  histories: Record<string, Chat>;
  repaired: boolean;
} {
  if (!isRecord(rawValue)) {
    return { histories: {}, repaired: false };
  }

  const input = rawValue as Record<string, Partial<Chat>>;
  const histories: Record<string, Chat> = {};
  let repaired = false;

  for (const [key, value] of Object.entries(input)) {
    if (!isRecord(value)) {
      continue;
    }

    const safeConversation = Array.isArray(value.conversation)
      ? value.conversation.filter(
          (msg) =>
            isRecord(msg) &&
            typeof msg.id === 'string' &&
            (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') &&
            typeof msg.content === 'string' &&
            typeof msg.timestamp === 'number'
        )
      : [];

    const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : key;
    if (id !== value.id) {
      repaired = true;
    }

    histories[key] = {
      id,
      title: typeof value.title === 'string' ? value.title : 'Untitled chat',
      conversation: safeConversation,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
      pinned: typeof value.pinned === 'boolean' ? value.pinned : false,
      model: typeof value.model === 'string' ? value.model : null,
      usage: typeof value.usage === 'number' ? value.usage : 0,
    };
  }

  return { histories, repaired };
}

export function loadChatHistories(storage: Pick<Storage, 'getItem' | 'setItem'>): Record<string, Chat> {
  const saved = storage.getItem(CHAT_STORAGE_KEY);
  if (!saved) {
    return {};
  }

  try {
    const parsed = JSON.parse(saved) as unknown;
    const { histories, repaired } = repairChatHistories(parsed);
    if (repaired) {
      storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(histories));
    }
    return histories;
  } catch {
    return {};
  }
}

export function saveChatHistories(
  storage: Pick<Storage, 'setItem'>,
  histories: Record<string, Chat>
): void {
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify(histories));
}
