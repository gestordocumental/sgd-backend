import { parsePdf, parsePdfFull } from './pdf.parser';
import { parseDocx, parseDocxStructured, type DocxStructure } from './docx.parser';
import { parseXlsx, parseXlsxStructured } from './xlsx.parser';

export type { DocxStructure };
export type { DocxStructure as ExtractionStructure };

// Note: application/msword (.doc binary) is intentionally excluded — mammoth only
// supports OOXML (.docx). A .doc file would cause a silent parse failure.
const MIME_PARSERS: Record<string, (buf: Buffer) => Promise<string>> = {
  'application/pdf': parsePdf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseDocx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': parseXlsx,
};

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Selects a parser for the provided MIME type and returns the extracted plain text.
 *
 * @param mimeType - The document MIME type used to select the parser
 * @returns The extracted plain text, or `null` if the MIME type is unsupported
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  const parser = MIME_PARSERS[mimeType];
  if (!parser) return null;
  return parser(buffer);
}

/**
 * Extracts structured document information (text plus header/table cell fields) when available.
 *
 * Uses the provided MIME type to choose a parser. For DOCX and XLSX returns parser-specific structured
 * results; for PDFs returns a structure with extracted text and `titleCell`, `leftCell`, and `rightCell`
 * set to `null`. If the MIME type is not supported, returns `null`.
 *
 * @param buffer - The document bytes to parse.
 * @param mimeType - MIME type used to select the appropriate parser; unsupported types result in `null`.
 * @returns A `DocxStructure` containing extracted `text` and cell fields (cells may be `null` for PDF), or `null` if the MIME type is unsupported.
 */
export async function extractStructured(buffer: Buffer, mimeType: string): Promise<DocxStructure | null> {
  if (!MIME_PARSERS[mimeType]) return null;

  if (DOCX_MIMES.has(mimeType)) {
    return parseDocxStructured(buffer);
  }

  if (XLSX_MIMES.has(mimeType)) {
    return parseXlsxStructured(buffer);
  }

  // PDF — use metadata title when available, otherwise fall through to text heuristics
  const { text, title } = await parsePdfFull(buffer);
  return { text, titleCell: title, leftCell: null, rightCell: null };
}
