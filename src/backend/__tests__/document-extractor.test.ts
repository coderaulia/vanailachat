import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../app.js';
import { detectKind, extractDocumentText, extractDocx, extractXlsx } from '../services/documentExtractor.js';

/** Minimal but structurally real .docx — the parts the extractor reads. */
function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join('');

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    ),
  });
}

/** Minimal .xlsx with a shared string table, as Excel actually writes them. */
function makeXlsx(rows: string[][]): Uint8Array {
  const shared: string[] = [];
  const indexOf = (value: string) => {
    const existing = shared.indexOf(value);
    if (existing !== -1) return existing;
    shared.push(value);
    return shared.length - 1;
  };

  const sheetRows = rows
    .map((row) => {
      const cells = row
        .map((value, column) => {
          if (value === '') return '';
          const numeric = Number(value);
          return Number.isFinite(numeric) && value.trim() !== ''
            ? `<c r="${String.fromCharCode(65 + column)}"><v>${value}</v></c>`
            : `<c r="${String.fromCharCode(65 + column)}" t="s"><v>${indexOf(value)}</v></c>`;
        })
        .join('');
      return `<row>${cells}</row>`;
    })
    .join('');

  return zipSync({
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
}

describe('detectKind', () => {
  it('recognises office and pdf files by extension', () => {
    expect(detectKind('handbook.docx')).toBe('docx');
    expect(detectKind('headcount.xlsx')).toBe('xlsx');
    expect(detectKind('offer.pdf')).toBe('pdf');
    expect(detectKind('notes.md')).toBe('text');
  });

  it('falls back to the mime type when the name has no extension', () => {
    expect(detectKind('upload', 'application/pdf')).toBe('pdf');
    expect(
      detectKind('upload', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
  });
});

describe('extractDocx', () => {
  it('pulls paragraph text out of the document body', () => {
    const text = extractDocx(makeDocx(['Parental Leave Policy', 'Primary caregivers get 16 weeks.']));

    expect(text).toContain('Parental Leave Policy');
    expect(text).toContain('Primary caregivers get 16 weeks.');
    // Paragraphs must not run together.
    expect(text).toMatch(/Policy\s*\n/);
    // No XML markup leaks through.
    expect(text).not.toContain('<w:');
  });

  it('decodes escaped entities', () => {
    expect(extractDocx(makeDocx(['R&amp;D headcount &lt; 50']))).toContain('R&D headcount < 50');
  });

  it('rejects a zip that is not a docx', () => {
    const notDocx = zipSync({ 'random.txt': strToU8('hello') });
    expect(() => extractDocx(notDocx)).toThrow(/not a valid \.docx/i);
  });
});

describe('extractXlsx', () => {
  it('resolves shared strings and emits one TSV row per sheet row', () => {
    const text = extractXlsx(
      makeXlsx([
        ['Name', 'Department', 'Salary'],
        ['Dewi', 'People Ops', '95000'],
      ]),
    );

    expect(text).toContain('[Sheet: sheet1]');
    expect(text).toContain('Name\tDepartment\tSalary');
    expect(text).toContain('Dewi\tPeople Ops\t95000');
  });

  it('skips entirely empty rows', () => {
    const text = extractXlsx(makeXlsx([['Name'], ['', ''], ['Dewi']]));
    expect(text.split('\n').filter((line) => line.trim() && !line.startsWith('[Sheet'))).toHaveLength(2);
  });
});

describe('extractDocumentText', () => {
  it('returns plain text unchanged', async () => {
    const { kind, text } = await extractDocumentText('notes.txt', strToU8('just notes'));
    expect(kind).toBe('text');
    expect(text).toBe('just notes');
  });

  it('refuses unknown binary rather than emitting mojibake', async () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0xff]);
    await expect(extractDocumentText('mystery.bin', binary)).rejects.toThrow(/unsupported binary/i);
  });
});

describe('POST /api/attachments/extract', () => {
  it('extracts an uploaded docx', async () => {
    const app = createApp();
    const form = new FormData();
    form.append(
      'file',
      new File([makeDocx(['Termination checklist'])], 'policy.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );

    const response = await app.request('/api/attachments/extract', { method: 'POST', body: form });
    const body = (await response.json()) as { kind: string; text: string };

    expect(response.status).toBe(200);
    expect(body.kind).toBe('docx');
    expect(body.text).toContain('Termination checklist');
  });

  it('rejects a request with no file', async () => {
    const app = createApp();
    const response = await app.request('/api/attachments/extract', {
      method: 'POST',
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });
});
