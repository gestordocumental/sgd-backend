import * as mammoth from 'mammoth';
import * as JSZip from 'jszip';

export interface DocxStructure {
  text:      string;
  titleCell: string | null;   // Document title extracted directly from header (company name already excluded)
  rightCell: string | null;   // Metadata cell: Código, Versión, Fecha, Página
  leftCell:  string | null;   // Fallback: company + title mixed (when header XML not available)
}

/**
 * Extracts plain text from a DOCX file provided as a buffer.
 *
 * @returns The extracted plain text, or an empty string if extraction fails or no text is found
 */

export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Extract structured text and header metadata from a DOCX buffer.
 *
 * Attempts to extract plain text and parse header table cells to identify a metadata cell (labels like "Código" or "Versión"), a company-like cell, and a title-like cell.
 *
 * @param buffer - DOCX file contents as a Buffer
 * @returns A `DocxStructure` containing:
 *  - `text`: the plain extracted document text;
 *  - `titleCell`: the header title cell if found, otherwise `null`;
 *  - `rightCell`: the header metadata cell matching "Código" or "Versión", otherwise `null`;
 *  - `leftCell`: when both company and title are found, the string `${company}\n${title}`; otherwise the found company or title; `null` if neither field is found or header parsing fails.
 */

export async function parseDocxStructured(buffer: Buffer): Promise<DocxStructure> {
  const text = await parseDocx(buffer);

  try {
    const zip   = await (JSZip as any).loadAsync(buffer);
    const cells = await extractHeaderCells(zip);

    // Identify metadata cell (contains Código or Versión label)
    const metadataCell = cells.find((c) => /c[oó]digo|versi[oó]n/i.test(c)) ?? null;

    // Remaining non-empty cells: company name (short/uppercase) and title (descriptive)
    const others = cells.filter((c) => c !== metadataCell);

    const companyCell = others.find((c) => looksLikeCompany(c)) ?? null;
    const titleCell   = others.find((c) => c !== companyCell)   ?? null;

    return {
      text,
      titleCell,
      rightCell: metadataCell,
      leftCell:  companyCell && titleCell
        ? `${companyCell}\n${titleCell}`  // fallback combined form
        : (companyCell ?? titleCell),
    };
  } catch {
    return { text, titleCell: null, rightCell: null, leftCell: null };
  }
}

// ─── Header XML cell extraction ───────────────────────────────────────────────

const HEADER_FILES = ['word/header2.xml', 'word/header1.xml', 'word/header3.xml'];

/**
 * Extracts the first non-empty list of table cell texts found in the document header files.
 *
 * Scans HEADER_FILES (e.g., word/header2.xml, header1.xml, header3.xml) in order and returns the extracted cell texts from the first header that contains a table; returns an empty array if none are found.
 *
 * @param zip - A ZIP-like object (JSZip) representing the DOCX archive, with header XML files accessible via zip.files[fileName].
 * @returns The list of non-empty cell texts extracted from the header table, or an empty array if no header table cells are found.
 */
async function extractHeaderCells(zip: any): Promise<string[]> {
  for (const fileName of HEADER_FILES) {
    if (!zip.files[fileName]) continue;

    const xml   = await zip.files[fileName].async('string');
    if (!xml.includes('<w:tbl>') && !xml.includes('<w:tbl ')) continue;

    const cells = parseCellsFromXml(xml);
    if (cells.length > 0) return cells;
  }
  return [];
}

/**
 * Extracts meaningful text content from table cells (<w:tc>) in WordprocessingML header XML.
 *
 * Parses each table cell, collects its paragraph text runs, joins paragraphs with `\n`, trims
 * the result, and returns only non-empty cells that are not recognized as watermarks.
 * Cells that are continuations of a vertical merge (`vMerge`) are skipped.
 *
 * @param xml - The XML string to parse (typically a header XML from a DOCX file)
 * @returns An array of extracted cell texts, one entry per non-empty, non-watermark cell
 */
function parseCellsFromXml(xml: string): string[] {
  const results: string[] = [];

  // Match each <w:tc>...</w:tc> block (non-greedy)
  const tcRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
  let tcMatch: RegExpExecArray | null;

  while ((tcMatch = tcRegex.exec(xml)) !== null) {
    const cellXml = tcMatch[0];

    // Skip vMerge continuation cells — they are merged into a preceding cell
    const isMergeStart = /<w:vMerge[^/]*w:val="restart"/.test(cellXml);
    const isMergeCont  = /<w:vMerge\s*\/>/.test(cellXml) ||
                         (/<w:vMerge\b/.test(cellXml) && !isMergeStart);
    if (isMergeCont) continue;

    // Extract text paragraph by paragraph
    const paragraphs: string[] = [];
    const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(cellXml)) !== null) {
      const pXml = pMatch[0];
      const runs: string[] = [];
      const tRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
      let tMatch: RegExpExecArray | null;

      while ((tMatch = tRegex.exec(pXml)) !== null) {
        if (tMatch[1]) runs.push(tMatch[1]);
      }

      const line = runs.join('').trim();
      if (line) paragraphs.push(line);
    }

    const cellText = paragraphs.join('\n').trim();

    // Skip watermark cells and empty cells
    if (!cellText || isWatermark(cellText)) continue;

    results.push(cellText);
  }

  return results;
}

/**
 * Determines whether the given text is the "USO INTERNO" watermark.
 *
 * @param text - Input text to test for the watermark
 * @returns `true` if the trimmed text equals `USO INTERNO` (case-insensitive, allowing one or more spaces between the words), `false` otherwise.
 */
function isWatermark(text: string): boolean {
  // Watermarks come from v:textpath attributes — they don't appear in w:t,
  // but defensive check in case of edge cases
  return /^USO\s+INTERNO$/i.test(text.trim());
}

/**
 * Detects whether a string likely represents a company name.
 *
 * @param text - Candidate text (e.g., a header/table cell) to evaluate as a company name
 * @returns `true` if `text` contains common corporate suffixes (like "S.A.S", "LTDA", "Corp", "Inc", "Cia", "Grupo", "Holding") or is at most five words and entirely uppercase; `false` otherwise
 */
function looksLikeCompany(text: string): boolean {
  if (/\b(s\.?\s*a\.?\s*s?\.?|ltda\.?|corp\.?|inc\.?|cia\.?|grupo|holding)\b/i.test(text)) return true;
  const words = text.trim().split(/\s+/);
  if (words.length <= 5 && text === text.toUpperCase()) return true;
  return false;
}
