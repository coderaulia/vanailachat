import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { DatabaseService } from '../services/database.js';

describe('regenerate / edit history', () => {
  let chatId: string;

  beforeEach(() => {
    DatabaseService.close();
    DatabaseService.initialize(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-versions-')), 'test.sqlite'));
    chatId = DatabaseService.upsertChat({ title: 'Versions' }).id;
    DatabaseService.insertMessage({ id: 'u1', chatId, role: 'user', content: 'question', createdAt: 1 });
    DatabaseService.insertMessage({ id: 'a1', chatId, role: 'assistant', content: 'first answer', createdAt: 2 });
    DatabaseService.insertMessage({ id: 'u2', chatId, role: 'user', content: 'follow-up', createdAt: 3 });
    DatabaseService.insertMessage({ id: 'a2', chatId, role: 'assistant', content: 'follow-up answer', createdAt: 4 });
  });

  afterEach(() => DatabaseService.close());

  it('a regenerated answer no longer reappears after reload', () => {
    expect(DatabaseService.supersedeMessagesFrom(chatId, 'a1')).toBe(3);
    DatabaseService.insertMessage({ id: 'a1b', chatId, role: 'assistant', content: 'second answer', createdAt: 5, versionOf: 'a1' });

    const live = DatabaseService.listMessages(chatId);
    expect(live.map((m) => m.id)).toEqual(['u1', 'a1b']);
    expect(live[1].versionCount).toBe(2);
    expect(live[0].versionCount).toBe(1);
  });

  it('keeps every earlier answer browsable, oldest first', () => {
    DatabaseService.supersedeMessagesFrom(chatId, 'a1');
    DatabaseService.insertMessage({ id: 'a1b', chatId, role: 'assistant', content: 'second', createdAt: 5, versionOf: 'a1' });
    DatabaseService.supersedeMessagesFrom(chatId, 'a1b');
    DatabaseService.insertMessage({ id: 'a1c', chatId, role: 'assistant', content: 'third', createdAt: 6, versionOf: 'a1' });

    const versions = DatabaseService.listMessageVersions('a1c');
    expect(versions.map((v) => v.content)).toEqual(['first answer', 'second', 'third']);
    expect(versions.map((v) => v.current)).toEqual([false, false, true]);
    expect(DatabaseService.listMessageVersions('a1').map((v) => v.id)).toEqual(['a1', 'a1b', 'a1c']);
  });

  it('saving a message again makes it live, so a reply the server stored mid-stream survives', () => {
    // Server writes the new reply while streaming; a late supersede would catch it...
    DatabaseService.insertMessage({ id: 'a2b', chatId, role: 'assistant', content: 'partial', createdAt: 10 });
    DatabaseService.supersedeMessagesFrom(chatId, 'u2');
    expect(DatabaseService.listMessages(chatId).map((m) => m.id)).not.toContain('a2b');
    // ...and the client's own save of the same id brings it back.
    DatabaseService.insertMessage({ id: 'a2b', chatId, role: 'assistant', content: 'final', createdAt: 10, versionOf: 'a2' });
    expect(DatabaseService.listMessages(chatId).map((m) => m.id)).toContain('a2b');
  });

  it('editing a question hides it and everything after it', () => {
    DatabaseService.supersedeMessagesFrom(chatId, 'u2');
    expect(DatabaseService.listMessages(chatId).map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('hides superseded messages from search', () => {
    DatabaseService.supersedeMessagesFrom(chatId, 'u2');
    expect(DatabaseService.searchMessages('follow')).toHaveLength(0);
    expect(DatabaseService.searchMessages('question')).toHaveLength(1);
  });

  it('exposes supersede and versions over HTTP', async () => {
    const app = createApp();
    const response = await app.request('/api/messages/supersede', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, fromMessageId: 'a2' }),
    });
    expect(await response.json()).toEqual({ superseded: 1 });

    await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'a2b', chatId, role: 'assistant', content: 'retry', createdAt: 9, versionOf: 'a2' }),
    });
    const versions = await (await app.request('/api/messages/a2b/versions')).json() as { versions: Array<{ id: string }> };
    expect(versions.versions.map((v) => v.id)).toEqual(['a2', 'a2b']);
  });
});

describe('archived chats', () => {
  beforeEach(() => {
    DatabaseService.close();
    DatabaseService.initialize(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-archive-')), 'test.sqlite'));
  });

  afterEach(() => DatabaseService.close());

  it('archives and restores through PATCH without touching other fields', async () => {
    const chat = DatabaseService.upsertChat({ title: 'Old work', pinned: true });
    expect(chat.archived).toBe(false);
    const app = createApp();

    const archive = await app.request(`/api/chats/${chat.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const archived = (await archive.json() as { chat: { archived: boolean; pinned: boolean; title: string } }).chat;
    expect(archived).toMatchObject({ archived: true, pinned: true, title: 'Old work' });

    await app.request(`/api/chats/${chat.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    });
    expect(DatabaseService.getChat(chat.id)?.archived).toBe(false);
  });
});
