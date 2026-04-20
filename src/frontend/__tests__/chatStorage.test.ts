import { describe, expect, it } from 'vitest';
import {
  CHAT_STORAGE_KEY,
  loadChatHistories,
  repairChatHistories,
} from '../lib/chatStorage';

describe('chat storage migration', () => {
  it('repairs missing chat ids using object keys', () => {
    const { histories, repaired } = repairChatHistories({
      alpha: {
        title: 'Legacy Chat',
        conversation: [],
        createdAt: 1,
        updatedAt: 2,
        model: 'llama3',
      },
    });

    expect(repaired).toBe(true);
    expect(histories.alpha.id).toBe('alpha');
    expect(histories.alpha.title).toBe('Legacy Chat');
  });

  it('writes repaired histories back to storage', () => {
    const storageState: Record<string, string> = {
      [CHAT_STORAGE_KEY]: JSON.stringify({
        chat_a: {
          title: 'Needs repair',
          conversation: [],
          createdAt: 1,
          updatedAt: 2,
          model: null,
        },
      }),
    };

    const storage = {
      getItem(key: string) {
        return storageState[key] ?? null;
      },
      setItem(key: string, value: string) {
        storageState[key] = value;
      },
    };

    const histories = loadChatHistories(storage);

    expect(histories.chat_a.id).toBe('chat_a');
    expect(storageState[CHAT_STORAGE_KEY]).toContain('"id":"chat_a"');
  });
});
