import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const MAX_DOCUMENT_CHARS = 250_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[0-9a-f-]{36}--[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.docx$/;

export interface GeneratedDocument {
  kind: 'generated_file';
  name: string;
  url: string;
  bytes: number;
  mimeType: string;
}

export function generatedDocumentsDirectory(): string {
  return process.env.GENERATED_DOCUMENTS_DIR || path.join(process.cwd(), 'data', 'generated');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sanitizeFilename(value: string): string {
  const withoutExtension = value.replace(/\.docx$/i, '');
  const safe = withoutExtension
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 70);
  return `${safe || 'document'}.docx`;
}

function paragraphXml(rawLine: string): string {
  let line = rawLine;
  let style = '';
  const heading = line.match(/^(#{1,2})\s+(.+)$/);

  if (heading) {
    style = `<w:pPr><w:pStyle w:val="Heading${heading[1].length}"/></w:pPr>`;
    line = heading[2];
  } else if (/^[-*]\s+/.test(line)) {
    line = `• ${line.replace(/^[-*]\s+/, '')}`;
  }

  line = line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
  if (!line.trim()) return '<w:p/>';
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
}

export function createDocx(content: string): Uint8Array {
  const paragraphs = content.replace(/\r\n/g, '\n').split('\n').map(paragraphXml).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
      'word/document.xml': strToU8(documentXml),
      'word/styles.xml': strToU8(stylesXml),
      'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { level: 6 },
  );
}

async function cleanupExpired(directory: string): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !TOKEN_PATTERN.test(entry.name)) return;
      const filePath = path.join(directory, entry.name);
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < cutoff) await fs.unlink(filePath);
    }));
  } catch {
    // Best-effort retention cleanup.
  }
}

export async function generateDocument(
  filename: string,
  content: string,
  directory = generatedDocumentsDirectory(),
): Promise<GeneratedDocument> {
  if (!content.trim()) throw new Error('Document content is required');
  if (content.length > MAX_DOCUMENT_CHARS) {
    throw new Error(`Document exceeds ${MAX_DOCUMENT_CHARS} characters`);
  }

  const safeName = sanitizeFilename(filename);
  const token = `${crypto.randomUUID()}--${safeName}`;
  const data = createDocx(content);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, token), data);
  void cleanupExpired(directory);

  return {
    kind: 'generated_file',
    name: safeName,
    url: `/api/attachments/generated/${encodeURIComponent(token)}`,
    bytes: data.byteLength,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

export async function readGeneratedDocument(
  token: string,
  directory = generatedDocumentsDirectory(),
): Promise<{ descriptor: GeneratedDocument; data: Uint8Array }> {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Generated document not found');

  const data = await fs.readFile(path.join(directory, token));
  const name = token.slice(token.indexOf('--') + 2);
  return {
    descriptor: {
      kind: 'generated_file',
      name,
      url: `/api/attachments/generated/${encodeURIComponent(token)}`,
      bytes: data.byteLength,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    data,
  };
}

export function parseGeneratedDocumentResult(value: string): GeneratedDocument | null {
  try {
    const parsed = JSON.parse(value) as Partial<GeneratedDocument>;
    if (
      parsed.kind === 'generated_file' &&
      typeof parsed.name === 'string' &&
      typeof parsed.url === 'string' &&
      typeof parsed.bytes === 'number' &&
      typeof parsed.mimeType === 'string'
    ) {
      return parsed as GeneratedDocument;
    }
  } catch {
    // Normal tool outputs are not generated-file descriptors.
  }
  return null;
}

export function isUnverifiedGeneratedFileClaim(content: string): boolean {
  const normalized = content.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/\s+/g, ' ');
  return /\b(?:file|document)\s+(?:was|has been|is)\s+(?:generated|created|saved)\b/i.test(normalized) &&
    /\b(?:sandbox|server|download|attachment|temporary)\b/i.test(normalized);
}
