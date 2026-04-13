import * as mammoth from 'mammoth';

/**
 * Extracts plain text from a DOCX buffer using mammoth.
 * Returns empty string if parsing fails.
 */
export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  } catch {
    return '';
  }
}
