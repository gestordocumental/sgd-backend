import { parsePdf } from './pdf.parser';

// ── Module-level mock for pdf-parse ───────────────────────────────────────────

jest.mock('pdf-parse', () => jest.fn());

import * as pdfParse from 'pdf-parse';

const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

// ── parsePdf() ────────────────────────────────────────────────────────────────

describe('parsePdf()', () => {
  const buf = Buffer.from('fake pdf bytes');

  beforeEach(() => {
    mockPdfParse.mockReset();
  });

  it('returns the extracted text from a valid PDF buffer', async () => {
    mockPdfParse.mockResolvedValue({ text: 'Extracted PDF text', numpages: 1, numrender: 1, info: {}, metadata: null, version: '1.0' } as any);

    const result = await parsePdf(buf);

    expect(mockPdfParse).toHaveBeenCalledWith(buf);
    expect(result).toBe('Extracted PDF text');
  });

  it('returns empty string when pdf-parse returns undefined text', async () => {
    mockPdfParse.mockResolvedValue({ text: undefined, numpages: 0, numrender: 0, info: {}, metadata: null, version: '1.0' } as any);

    const result = await parsePdf(buf);

    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse returns null text', async () => {
    mockPdfParse.mockResolvedValue({ text: null, numpages: 0, numrender: 0, info: {}, metadata: null, version: '1.0' } as any);

    const result = await parsePdf(buf);

    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse throws (malformed PDF)', async () => {
    mockPdfParse.mockRejectedValue(new Error('Invalid PDF structure'));

    const result = await parsePdf(buf);

    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse throws a non-Error value', async () => {
    mockPdfParse.mockRejectedValue('string error');

    const result = await parsePdf(buf);

    expect(result).toBe('');
  });

  it('returns the full multi-page text content', async () => {
    const multiPageText = 'Page 1 content\nPage 2 content\nPage 3 content';
    mockPdfParse.mockResolvedValue({ text: multiPageText, numpages: 3, numrender: 3, info: {}, metadata: null, version: '1.0' } as any);

    const result = await parsePdf(buf);

    expect(result).toBe(multiPageText);
  });

  it('returns empty string for an empty PDF (no text)', async () => {
    mockPdfParse.mockResolvedValue({ text: '', numpages: 1, numrender: 1, info: {}, metadata: null, version: '1.0' } as any);

    const result = await parsePdf(buf);

    expect(result).toBe('');
  });

  it('passes the buffer directly to pdf-parse without modification', async () => {
    const specificBuffer = Buffer.from('specific-pdf-data');
    mockPdfParse.mockResolvedValue({ text: 'ok', numpages: 1, numrender: 1, info: {}, metadata: null, version: '1.0' } as any);

    await parsePdf(specificBuffer);

    expect(mockPdfParse).toHaveBeenCalledWith(specificBuffer);
  });
});
