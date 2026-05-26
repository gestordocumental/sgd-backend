import * as pdfParse from 'pdf-parse';

/**
 * Extract plain text from a PDF buffer.
 *
 * @param buffer - PDF file contents as a Buffer
 * @returns The extracted text, or an empty string if parsing fails or no text is present
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text ?? '';
  } catch {
    return '';
  }
}
