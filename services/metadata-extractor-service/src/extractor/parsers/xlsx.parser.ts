// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs');

export interface XlsxStructure {
  text:      string;
  titleCell: string | null;
  leftCell:  string | null;
  rightCell: string | null;
}

/**
 * Extracts text from every worksheet in an XLSX file and concatenates all non-empty cell values.
 *
 * @param buffer - In-memory `.xlsx` file contents
 * @returns All non-empty cell texts from every worksheet joined by `\n`
 */

export async function parseXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const lines: string[] = [];
  workbook.worksheets.forEach((ws: any) => {
    ws.eachRow((row: any) => {
      row.eachCell((cell: any) => {
        const val = cellText(cell);
        if (val) lines.push(val);
      });
    });
  });
  return lines.join('\n');
}

/**
 * Extracts all text from an XLSX buffer and heuristically detects title, company and metadata cells from the first worksheet.
 *
 * Scans every worksheet to produce a single newline-delimited text blob, then examines up to the first 10 rows of the first worksheet
 * to build a unique-ordered header sample. From that sample it selects a metadata cell (labels matching `código` or `versión`),
 * identifies a company-like value using legal-form and uppercase heuristics, and picks a title as the first remaining header entry.
 *
 * @returns An XlsxStructure containing:
 *  - `text`: the full extracted text from all worksheets,
 *  - `titleCell`: the detected title value or `null`,
 *  - `leftCell`: the company and title combined with a newline when both are present, otherwise the single detected value or `null`,
 *  - `rightCell`: the detected metadata value (e.g., "Código" or "Versión") or `null`.
 */

export async function parseXlsxStructured(buffer: Buffer): Promise<XlsxStructure> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.worksheets[0];
  if (!ws) return { text: '', titleCell: null, leftCell: null, rightCell: null };

  // Full text from all sheets (reuse loaded workbook)
  const lines: string[] = [];
  workbook.worksheets.forEach((sheet: any) => {
    sheet.eachRow((row: any) => {
      row.eachCell((cell: any) => {
        const val = cellText(cell);
        if (val) lines.push(val);
      });
    });
  });
  const text = lines.join('\n');

  // Collect unique non-empty cell values from first 10 rows
  const seen   = new Set<string>();
  const header: string[] = [];
  let   rowIdx = 0;

  ws.eachRow((row: any) => {
    if (rowIdx >= 10) return;
    rowIdx++;
    row.eachCell((cell: any) => {
      const val = cellText(cell).trim();
      if (val.length >= 2 && !seen.has(val)) {
        seen.add(val);
        header.push(val);
      }
    });
  });

  // Metadata cell: contains Código or Versión labels
  const metadataCell = header.find((c) => /c[oó]digo|versi[oó]n/i.test(c)) ?? null;
  const others       = header.filter((c) => c !== metadataCell);

  // Company cell: matches legal suffix or 1-2 token all-caps abbreviation
  const companyCell = others.find((c) => looksLikeCompany(c)) ?? null;

  // Title cell: first remaining non-metadata, non-company cell
  const titleCell = others.find((c) => c !== companyCell) ?? null;

  return {
    text,
    titleCell,
    rightCell: metadataCell,
    leftCell:  companyCell && titleCell
      ? `${companyCell}\n${titleCell}`
      : (companyCell ?? titleCell),
  };
}

/**
 * Extracts a normalized text representation from an Excel cell.
 *
 * @param cell - Cell object (as provided by ExcelJS). The function reads `cell.value` and supports primitive types, Date, richText, formula `result`, and objects with a `text` property.
 * @returns The cell value converted to a plain string; dates are returned as `YYYY-MM-DD`; returns an empty string for `null`, `undefined`, or absent formula results.
 */

function cellText(cell: any): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'string')  return val;
  if (typeof val === 'number')  return String(val);
  if (typeof val === 'boolean') return String(val);
  if (val instanceof Date)      return val.toISOString().split('T')[0];
  if (typeof val === 'object') {
    if ('richText' in val) return val.richText.map((r: any) => r.text).join('');
    if ('result'   in val) return val.result !== null && val.result !== undefined ? String(val.result) : '';
    if ('text'     in val) return String(val.text);
  }
  return String(val);
}

/**
 * Determines whether a text string resembles a company name or contains common corporate identifiers.
 *
 * @param text - The input text to evaluate as a potential company name
 * @returns `true` if `text` matches common corporate legal forms (e.g., "Ltda.", "Inc.", "Grupo", "Holding") or is a short uppercase abbreviation-like name, `false` otherwise.
 */
function looksLikeCompany(text: string): boolean {
  if (/\b(s\.?\s*a\.?\s*s?\.?|ltda\.?|corp\.?|inc\.?|cia\.?|grupo|holding)\b/i.test(text)) return true;
  const words = text.trim().split(/\s+/);
  if (words.length <= 2 && text === text.toUpperCase() && text.length < 30) return true;
  return false;
}
