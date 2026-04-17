import * as mammoth from 'mammoth';
import * as JSZip from 'jszip';

export interface DocxStructure {
  text:      string;
  titleCell: string | null;   // Document title extracted directly from header (company name already excluded)
  rightCell: string | null;   // Metadata cell: Código, Versión, Fecha, Página
  leftCell:  string | null;   // Fallback: company + title mixed (when header XML not available)
}

// ─── Plain text extraction ────────────────────────────────────────────────────

export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  } catch {
    return '';
  }
}

// ─── Structured extraction (reads header2.xml directly via JSZip) ─────────────

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
 * Extracts non-empty, non-watermark text from each <w:tc> in the XML.
 * Skips vMerge continuation cells (they have no unique content).
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

function isWatermark(text: string): boolean {
  // Watermarks come from v:textpath attributes — they don't appear in w:t,
  // but defensive check in case of edge cases
  return /^USO\s+INTERNO$/i.test(text.trim());
}

function looksLikeCompany(text: string): boolean {
  if (/\b(s\.?\s*a\.?\s*s?\.?|ltda\.?|corp\.?|inc\.?|cia\.?|grupo|holding)\b/i.test(text)) return true;
  const words = text.trim().split(/\s+/);
  if (words.length <= 5 && text === text.toUpperCase()) return true;
  return false;
}
