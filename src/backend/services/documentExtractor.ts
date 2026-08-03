import { unzipSync, strFromU8 } from 'fflate';

/**
 * Text extraction for the document formats HR work actually runs on.
 *
 * The frontend previously ran readAsText over every non-image attachment, so a
 * .docx or .xlsx arrived as ZIP binary rendered as mojibake — thousands of
 * useless tokens and no readable content. DOCX/XLSX are ZIP containers of XML,
 * so both are unpacked here rather than pulling in a heavyweight office suite.
 */

export type ExtractableKind = 'docx' | 'xlsx' | 'pdf' | 'text';

/** Cap extracted text so one large file cannot blow out the context window. */
const MAX_EXTRACTED_CHARS = 200_000;

export function detectKind(filename: string, mimeType?: string): ExtractableKind {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
  if (lower.endsWith('.pdf')) return 'pdf';

  if (mimeType?.includes('wordprocessingml')) return 'docx';
  if (mimeType?.includes('spreadsheetml')) return 'xlsx';
  if (mimeType === 'application/pdf') return 'pdf';

  return 'text';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function truncate(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[truncated — file exceeds ${MAX_EXTRACTED_CHARS} characters]`;
}

/**
 * DOCX: word/document.xml holds the body. Paragraph and break tags become
 * newlines before the remaining markup is stripped, otherwise every paragraph
 * runs together into one unreadable line.
 */
export function extractDocx(data: Uint8Array): string {
  const files = unzipSync(data);
  const documentXml = files['word/document.xml'];
  if (!documentXml) {
    throw new Error('Not a valid .docx (missing word/document.xml)');
  }

  const xml = strFromU8(documentXml);

  const text = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');

  return truncate(decodeXmlEntities(text).trim());
}

/**
 * XLSX: cell values live in sheetN.xml, but string cells (t="s") store an index
 * into the shared string table rather than the text itself, so that table has
 * to be resolved first. Output is TSV per sheet — compact and easy for a model
 * to read as a table.
 */
export function extractXlsx(data: Uint8Array): string {
  const files = unzipSync(data);

  const sharedStrings: string[] = [];
  const sharedTable = files['xl/sharedStrings.xml'];
  if (sharedTable) {
    const xml = strFromU8(sharedTable);
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const runs = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
      sharedStrings.push(decodeXmlEntities(runs.join('')));
    }
  }

  const sheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();

  if (sheetNames.length === 0) {
    throw new Error('Not a valid .xlsx (no worksheets found)');
  }

  const sections: string[] = [];

  for (const sheetName of sheetNames) {
    const xml = strFromU8(files[sheetName]);
    const rows: string[] = [];

    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];

      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);

        if (!valueMatch) {
          // Inline strings carry their text directly instead of via <v>.
          const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('');
          cells.push(decodeXmlEntities(inline));
          continue;
        }

        const raw = decodeXmlEntities(valueMatch[1]);
        if (/t="s"/.test(attributes)) {
          const index = Number.parseInt(raw, 10);
          cells.push(Number.isFinite(index) ? sharedStrings[index] ?? '' : '');
        } else {
          cells.push(raw);
        }
      }

      if (cells.some((cell) => cell !== '')) {
        rows.push(cells.join('\t'));
      }
    }

    if (rows.length > 0) {
      const label = sheetName.replace('xl/worksheets/', '').replace('.xml', '');
      sections.push(`[Sheet: ${label}]\n${rows.join('\n')}`);
    }
  }

  return truncate(sections.join('\n\n'));
}

export async function extractPdf(data: Uint8Array): Promise<string> {
  // Imported lazily so the parser (and its pdf.js bundle) is only loaded when
  // a PDF actually arrives.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: Buffer.from(data) });

  try {
    const result = await parser.getText();
    return truncate(String(result.text ?? '').trim());
  } finally {
    await parser.destroy();
  }
}

/**
 * Extract readable text from an uploaded document. Text-like files are returned
 * as UTF-8; unknown binary formats raise rather than emitting mojibake.
 */
export async function extractDocumentText(
  filename: string,
  data: Uint8Array,
  mimeType?: string,
): Promise<{ kind: ExtractableKind; text: string }> {
  const kind = detectKind(filename, mimeType);

  switch (kind) {
    case 'docx':
      return { kind, text: extractDocx(data) };
    case 'xlsx':
      return { kind, text: extractXlsx(data) };
    case 'pdf':
      return { kind, text: await extractPdf(data) };
    default: {
      const text = strFromU8(data);
      // A NUL byte in the first KB means this is binary, not text.
      if (text.slice(0, 1024).includes('\u0000')) {
        throw new Error(`Unsupported binary file type: ${filename}`);
      }
      return { kind, text: truncate(text) };
    }
  }
}
