import * as pdfParse from 'pdf-parse';

/**
 * Extract plain text from a PDF buffer.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text ?? '';
  } catch {
    return '';
  }
}

/**
 * Extract plain text AND the document title from PDF metadata (info.Title).
 * Returns title=null when the metadata field is absent, blank, or not useful.
 * Used by extractStructured so the PDF title cell can be passed to the rules engine.
 */
export async function parsePdfFull(buffer: Buffer): Promise<{ text: string; title: string | null }> {
  try {
    const data = await pdfParse(buffer);
    const raw = (data.info as Record<string, unknown> | undefined)?.['Title'];
    if (typeof raw !== 'string' || raw.trim().length < 3) {
      return { text: data.text ?? '', title: null };
    }

    // Fix UTF-8 bytes misread as Latin-1 — common in PDFs produced by Windows tools.
    // "ó" (UTF-8: 0xC3 0xB3) gets stored raw and decoded char-by-char as "Ã³".
    let title = fixPdfEncoding(raw.trim());

    // Strip leading document code (e.g. "AD-C-F-002 ", "FO-COM-001-2022 ")
    // eslint-disable-next-line security/detect-unsafe-regex
    title = title.replace(/^[A-ZÁÉÍÓÚÑ]{1,8}(?:-[A-ZÁÉÍÓÚÑ0-9]{1,8}){1,6}\s+/i, '').trim();

    // Discard if the metadata title is a filename or file path.
    // PDFs exported from Excel inherit the .xlsx filename as the PDF Title property.
    if (/\.(xlsx?|docx?|pdf|csv|txt)$/i.test(title) || /[/\\]/.test(title)) {
      return { text: data.text ?? '', title: null };
    }

    // Discard if title looks truncated — ends with an isolated 1–2 char fragment,
    // which indicates the metadata was saved with the value cut off mid-word.
    if (/\s\S{1,2}$/.test(title)) {
      return { text: data.text ?? '', title: null };
    }

    return { text: data.text ?? '', title: title.length >= 5 ? title : null };
  } catch {
    return { text: '', title: null };
  }
}

/**
 * Attempts to fix double-encoded UTF-8 text (Latin-1 misread).
 * "Ã³" → re-encodes each char as a Latin-1 byte → decodes the byte sequence as UTF-8.
 * Only applies the fix when the result is cleaner (no replacement characters).
 */
function fixPdfEncoding(str: string): string {
  // Quick check: if all codepoints fit in Latin-1 range and the string contains 'Ã' (U+00C3),
  // it is very likely double-encoded UTF-8.
  if (!str.includes('Ã') && !str.includes('Â')) return str;
  try {
    const fixed = Buffer.from(str, 'latin1').toString('utf8');
    if (!fixed.includes('�')) return fixed;
  } catch { /* ignore */ }
  return str;
}
