import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { attachmentsRouter } from '../routes/attachments.js';
import { extractDocx } from '../services/documentExtractor.js';
import {
  generateDocument,
  isUnverifiedGeneratedFileClaim,
  parseGeneratedDocumentResult,
} from '../services/generatedDocuments.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('generated documents', () => {
  it('creates a real DOCX and serves it as a download', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vanaila-generated-'));
    temporaryDirectories.push(directory);
    const generated = await generateDocument(
      '../Offer Letter.docx',
      '# Offer Letter\n\nWelcome to the team.\n\n- Start Monday',
      directory,
    );

    const app = new Hono();
    app.route('/api/attachments', attachmentsRouter(directory));
    const response = await app.request(generated.url);
    const data = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Offer-Letter.docx"',
    );
    expect(extractDocx(data)).toContain('Welcome to the team.');
  });

  it('rejects invalid download tokens and parses tool descriptors', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vanaila-generated-'));
    temporaryDirectories.push(directory);
    const app = new Hono();
    app.route('/api/attachments', attachmentsRouter(directory));

    expect((await app.request('/api/attachments/generated/..%2Fsecret.docx')).status).toBe(404);
    const descriptor = await generateDocument('notes.docx', 'Hello', directory);
    expect(parseGeneratedDocumentResult(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(parseGeneratedDocumentResult('normal tool output')).toBeNull();
    expect(
      isUnverifiedGeneratedFileClaim(
        "The file was generated inside the chat's sandbox environment. Look for a download attachment.",
      ),
    ).toBe(true);
    expect(isUnverifiedGeneratedFileClaim('Here is a draft you can review.')).toBe(false);
  });
});
