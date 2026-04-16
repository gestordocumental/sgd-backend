// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs');

export interface XlsxStructure {
  text:      string;
  titleCell: string | null;
  leftCell:  string | null;
  rightCell: string | null;
}

// ─── Plain text extraction (all sheets) ──────────────────────────────────────

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

// ─── Structured extraction (scans header rows of first sheet) ────────────────

export async function parseXlsxStructured(buffer: Buffer): Promise<XlsxStructure> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.worksheets[0];
  if (!ws) return { text: '', titleCell: null, leftCell: null, rightCell: null };

  // Full text from all sheets
  const text = await parseXlsx(buffer);

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function looksLikeCompany(text: string): boolean {
  if (/\b(s\.?\s*a\.?\s*s?\.?|ltda\.?|corp\.?|inc\.?|cia\.?|grupo|holding)\b/i.test(text)) return true;
  const words = text.trim().split(/\s+/);
  if (words.length <= 2 && text === text.toUpperCase() && text.length < 30) return true;
  return false;
}
