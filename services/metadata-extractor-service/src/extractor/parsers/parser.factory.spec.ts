import { extractText, extractStructured } from './parser.factory';

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('./pdf.parser', () => ({
  parsePdf:     jest.fn().mockResolvedValue('PDF text content'),
  parsePdfFull: jest.fn().mockResolvedValue({ text: 'PDF text content', title: null }),
}));

jest.mock('./docx.parser', () => ({
  parseDocx: jest.fn().mockResolvedValue('DOCX plain text'),
  parseDocxStructured: jest.fn().mockResolvedValue({
    text:      'DOCX full text',
    titleCell: 'Document Title',
    leftCell:  'Company Name\nDocument Title',
    rightCell: 'Código: POL-001\nVersión: 1.0',
  }),
}));

import { parsePdf, parsePdfFull } from './pdf.parser';
import { parseDocx, parseDocxStructured } from './docx.parser';

const PDF_MIME  = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const buf = Buffer.from('fake content');

// ── extractText() ─────────────────────────────────────────────────────────────

describe('extractText()', () => {
  it('delegates to parsePdf for PDF MIME', async () => {
    const result = await extractText(buf, PDF_MIME);
    expect(parsePdf).toHaveBeenCalledWith(buf);
    expect(result).toBe('PDF text content');
  });

  it('delegates to parseDocx for DOCX MIME', async () => {
    const result = await extractText(buf, DOCX_MIME);
    expect(parseDocx).toHaveBeenCalledWith(buf);
    expect(result).toBe('DOCX plain text');
  });

  it('returns null for legacy DOC MIME (not supported)', async () => {
    const result = await extractText(buf, 'application/msword');
    expect(result).toBeNull();
  });

  it('returns null for unsupported MIME type', async () => {
    const result = await extractText(buf, 'image/jpeg');
    expect(result).toBeNull();
  });

  it('returns null for unknown MIME type', async () => {
    const result = await extractText(buf, 'text/plain');
    expect(result).toBeNull();
  });
});

// ── extractStructured() ───────────────────────────────────────────────────────

describe('extractStructured()', () => {
  it('returns null for unsupported MIME type', async () => {
    const result = await extractStructured(buf, 'image/png');
    expect(result).toBeNull();
  });

  it('calls parseDocxStructured for DOCX MIME', async () => {
    const result = await extractStructured(buf, DOCX_MIME);
    expect(parseDocxStructured).toHaveBeenCalledWith(buf);
    expect(result).toEqual({
      text:      'DOCX full text',
      titleCell: 'Document Title',
      leftCell:  'Company Name\nDocument Title',
      rightCell: 'Código: POL-001\nVersión: 1.0',
    });
  });

  it('returns null for legacy DOC MIME (not supported)', async () => {
    const result = await extractStructured(buf, 'application/msword');
    expect(result).toBeNull();
  });

  it('returns flat structure for PDF (no table cells available)', async () => {
    const result = await extractStructured(buf, PDF_MIME);
    expect(parsePdfFull).toHaveBeenCalledWith(buf);
    expect(result).toEqual({
      text:      'PDF text content',
      titleCell: null,
      leftCell:  null,
      rightCell: null,
    });
  });
});
