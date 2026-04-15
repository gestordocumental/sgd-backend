import { parsePdf } from './pdf.parser';
import { parseDocx, parseDocxStructured, type DocxStructure } from './docx.parser';

export type { DocxStructure };
export type { DocxStructure as ExtractionStructure };

const MIME_PARSERS: Record<string, (buf: Buffer) => Promise<string>> = {
  'application/pdf':   parsePdf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseDocx,
  'application/msword': parseDocx,
};

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

/**
 * Selects the right parser based on mimeType and returns extracted plain text.
 * Returns null if the mimeType is not supported.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  const parser = MIME_PARSERS[mimeType];
  if (!parser) return null;
  return parser(buffer);
}

/**
 * Like extractText but also returns structured header cell data for DOCX files.
 */
export async function extractStructured(buffer: Buffer, mimeType: string): Promise<DocxStructure | null> {
  if (!MIME_PARSERS[mimeType]) return null;

  if (DOCX_MIMES.has(mimeType)) {
    return parseDocxStructured(buffer);
  }

  // PDF — no table structure available
  const text = await parsePdf(buffer);
  return { text, titleCell: null, leftCell: null, rightCell: null };
}
