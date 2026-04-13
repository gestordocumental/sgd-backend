import * as pdfParse from 'pdf-parse';

/**
 * Extracts plain text from a PDF buffer.
 * Returns empty string if parsing fails — the rules service handles nulls.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text ?? '';
  } catch {
    return '';
  }
}
