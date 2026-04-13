import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';

const MIME_PARSERS: Record<string, (buf: Buffer) => Promise<string>> = {
  'application/pdf':   parsePdf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseDocx,
  'application/msword': parseDocx,
};

/**
 * Selects the right parser based on mimeType and returns extracted plain text.
 * Returns null if the mimeType is not supported.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  const parser = MIME_PARSERS[mimeType];
  if (!parser) return null;
  return parser(buffer);
}
