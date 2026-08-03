import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import { extractDocumentText } from '../services/documentExtractor.js';
import {
  generatedDocumentsDirectory,
  readGeneratedDocument,
} from '../services/generatedDocuments.js';

/** Reject oversized uploads before reading them into memory. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function attachmentsRouter(
  generatedDirectory = generatedDocumentsDirectory(),
): Hono {
  const app = new Hono();

  /** Download a generated file by its opaque, server-issued token. */
  app.get('/generated/:token', async (context) => {
    try {
      const { descriptor, data } = await readGeneratedDocument(
        context.req.param('token'),
        generatedDirectory,
      );
      context.header('Content-Type', descriptor.mimeType);
      context.header('Content-Disposition', `attachment; filename="${descriptor.name}"`);
      context.header('Content-Length', String(data.byteLength));
      context.header('Cache-Control', 'private, no-store');
      const body = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      return context.body(body);
    } catch {
      return context.json({ error: 'Generated document not found' }, 404);
    }
  });

  /**
   * Extract readable text from an uploaded document.
   *
   * The browser can only usefully read plain text and images itself; .docx,
   * .xlsx and .pdf need unpacking, which happens here so the model receives
   * prose instead of ZIP binary.
   */
  app.post('/extract', async (context) => {
    try {
      const form = await context.req.formData();
      const file = form.get('file');

      if (!file || typeof file === 'string') {
        return context.json({ error: 'file field required' }, 400);
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return context.json(
          { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB, limit 25MB)` },
          413,
        );
      }

      const data = new Uint8Array(await file.arrayBuffer());
      const { kind, text } = await extractDocumentText(file.name, data, file.type);

      return context.json({
        name: file.name,
        kind,
        characters: text.length,
        text,
      });
    } catch (error) {
      return context.json({ error: sanitizeError(error, 'Extraction failed') }, 400);
    }
  });

  return app;
}
