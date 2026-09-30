import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { DatabaseService } from '../services/database.js';
import shapes from '../../../contracts/api-shapes.json' with { type: 'json' };

/**
 * The desktop app checks the same file in src-tauri/src/contract.rs, so a
 * field renamed on only one side fails one of the two suites.
 */
type Entity = Exclude<keyof typeof shapes, '$comment'>;

function expectShape(entity: Entity, value: unknown) {
  expect(value, `${entity} is missing`).toBeTypeOf('object');
  expect(Object.keys(value as object)).toEqual(expect.arrayContaining(shapes[entity]));
}

describe('web API matches contracts/api-shapes.json', () => {
  const app = createApp();
  let chatId = '';

  beforeAll(() => {
    DatabaseService.close();
    DatabaseService.initialize(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanaila-contract-')), 'test.sqlite'));
    const project = DatabaseService.listProjects()[0];
    const chat = DatabaseService.upsertChat({ projectId: project.id, title: 'Contract chat' });
    chatId = chat.id;
    DatabaseService.insertMessage({ chatId, role: 'user', content: 'question', createdAt: 1_000 });
    const answer = DatabaseService.insertMessage({ chatId, role: 'assistant', content: 'answer', createdAt: 2_000 });
    DatabaseService.upsertFeedback({ messageId: answer.id, rating: 1 });
    DatabaseService.upsertSkill({ name: 'contract-skill', description: 'd', content: 'c' });
    DatabaseService.upsertCodingSession({ chatId, harness: 'pi-harness', workspacePath: os.tmpdir(), status: 'ready' });
  });

  afterAll(() => DatabaseService.close());

  const get = async (url: string) => (await app.request(url)).json() as Promise<Record<string, unknown>>;
  const first = (value: unknown) => (value as unknown[])[0];

  it('project', async () => expectShape('project', first((await get('/api/projects')).projects)));
  it('chat', async () => expectShape('chat', first((await get('/api/chats')).chats)));
  it('message', async () => expectShape('message', first((await get(`/api/messages?chatId=${chatId}`)).messages)));
  it('skill', async () => expectShape('skill', first((await get('/api/skills')).skills)));
  it('trainingExample', async () => expectShape('trainingExample', first((await get('/api/training/examples')).examples)));
  it('trainingStats', async () => expectShape('trainingStats', await get('/api/training/stats')));
  it('codingSession', async () => expectShape('codingSession', (await get(`/api/coding/sessions/${chatId}`)).session));
  it('exportBundle', async () => expectShape('exportBundle', await get('/api/export')));
  it('messageSearchHit', async () => expectShape('messageSearchHit', first((await get('/api/messages/search?q=question')).results)));
});
