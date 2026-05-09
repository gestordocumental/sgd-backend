import { parseXlsx, parseXlsxStructured, XlsxStructure } from './xlsx.parser';

// ── Module-level mock for ExcelJS ─────────────────────────────────────────────
// xlsx.parser uses: const ExcelJS = require('exceljs');
// We mock the module so that `new ExcelJS.Workbook()` returns a controlled object.

const mockLoad = jest.fn().mockResolvedValue(undefined);

// _currentWorksheets is mutated per-test to control what the workbook exposes.
let _currentWorksheets: any[] = [];

jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    get xlsx() { return { load: mockLoad }; },
    get worksheets() { return _currentWorksheets; },
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const buf = Buffer.from('fake xlsx bytes');

/**
 * Builds a worksheet mock whose eachRow callback iterates the provided rows.
 * Each row is represented as a flat array of raw values.
 */
function makeWorksheetMock(rows: any[][]): any {
  return {
    eachRow(cb: (row: any) => void) {
      rows.forEach((rowCells) => {
        cb({
          eachCell(cellCb: (cell: any) => void) {
            rowCells.forEach((val) => cellCb({ value: val }));
          },
        });
      });
    },
  };
}

/** Sets the worksheets that will be returned by the Workbook mock. */
function setupWorkbook(sheetData: any[][][]) {
  _currentWorksheets = sheetData.map(makeWorksheetMock);
}

// ── parseXlsx() ───────────────────────────────────────────────────────────────

describe('parseXlsx()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoad.mockResolvedValue(undefined);
    _currentWorksheets = [];
  });

  it('returns concatenated text from all cells in all sheets', async () => {
    setupWorkbook([
      [['Hello', 'World'], ['Foo']],
      [['Bar']],
    ]);

    const result = await parseXlsx(buf);

    expect(result).toBe('Hello\nWorld\nFoo\nBar');
  });

  it('returns empty string when there are no worksheets', async () => {
    setupWorkbook([]);

    const result = await parseXlsx(buf);

    expect(result).toBe('');
  });

  it('skips cells with null or undefined values', async () => {
    setupWorkbook([[[null, undefined, 'Real Value']]]);

    const result = await parseXlsx(buf);

    expect(result).toBe('Real Value');
  });

  it('converts numeric cell values to strings', async () => {
    setupWorkbook([[[42, 3.14]]]);

    const result = await parseXlsx(buf);

    expect(result).toContain('42');
    expect(result).toContain('3.14');
  });

  it('converts boolean cell values to strings', async () => {
    setupWorkbook([[[true, false]]]);

    const result = await parseXlsx(buf);

    expect(result).toContain('true');
    expect(result).toContain('false');
  });

  it('converts Date cell values to ISO date strings', async () => {
    const d = new Date('2024-03-15T00:00:00.000Z');
    setupWorkbook([[[d]]]);

    const result = await parseXlsx(buf);

    expect(result).toContain('2024-03-15');
  });

  it('extracts richText cell values', async () => {
    setupWorkbook([[[{ richText: [{ text: 'Rich ' }, { text: 'Text' }] }]]]);

    const result = await parseXlsx(buf);

    expect(result).toBe('Rich Text');
  });

  it('extracts formula result cell values', async () => {
    setupWorkbook([[[{ result: 'Computed Value' }]]]);

    const result = await parseXlsx(buf);

    expect(result).toBe('Computed Value');
  });

  it('returns empty string for formula cells with null result', async () => {
    setupWorkbook([[[{ result: null }]]]);

    const result = await parseXlsx(buf);

    expect(result).toBe('');
  });

  it('extracts object cells with a "text" property', async () => {
    setupWorkbook([[[{ text: 'Text Property Value' }]]]);

    const result = await parseXlsx(buf);

    expect(result).toBe('Text Property Value');
  });
});

// ── parseXlsxStructured() ────────────────────────────────────────────────────

describe('parseXlsxStructured()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoad.mockResolvedValue(undefined);
    _currentWorksheets = [];
  });

  it('returns empty structure when there are no worksheets', async () => {
    setupWorkbook([]);

    const result = await parseXlsxStructured(buf);

    expect(result).toEqual<XlsxStructure>({
      text:      '',
      titleCell: null,
      leftCell:  null,
      rightCell: null,
    });
  });

  it('identifies metadata cell containing Código label as rightCell', async () => {
    setupWorkbook([
      [
        ['Document Policy Title'],
        ['Código: POL-001\nVersión: 1.0'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.rightCell).toContain('Código: POL-001');
  });

  it('identifies metadata cell containing Versión label as rightCell', async () => {
    setupWorkbook([
      [
        ['Some Title'],
        ['Versión: 2.5'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.rightCell).toContain('Versión: 2.5');
  });

  it('identifies metadata cell containing "codigo" (no accent) as rightCell', async () => {
    setupWorkbook([
      [
        ['Some Title'],
        ['codigo: DOC-001'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.rightCell).toContain('codigo: DOC-001');
  });

  it('identifies titleCell as non-company, non-metadata header cell', async () => {
    setupWorkbook([
      [
        ['Security Policy Manual'],
        ['Código: POL-001\nVersión: 1.0'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.titleCell).toBe('Security Policy Manual');
  });

  it('identifies company cell by legal suffix (S.A.S) and combines with title in leftCell', async () => {
    setupWorkbook([
      [
        ['Helisa S.A.S'],
        ['HR Onboarding Process'],
        ['Código: HR-001\nVersión: 3.0'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.leftCell).toContain('Helisa S.A.S');
    expect(result.leftCell).toContain('HR Onboarding Process');
    expect(result.titleCell).toBe('HR Onboarding Process');
    expect(result.rightCell).toContain('Código: HR-001');
  });

  it('identifies short all-caps company abbreviation (≤2 words, <30 chars) and sets leftCell', async () => {
    setupWorkbook([
      [
        ['ACME'],
        ['Training Manual'],
        ['Código: TRN-001'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.leftCell).toContain('ACME');
    expect(result.leftCell).toContain('Training Manual');
  });

  it('sets leftCell to companyCell alone when no titleCell is available', async () => {
    setupWorkbook([
      [
        ['ACME'],
        ['Código: TRN-001'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.leftCell).toBe('ACME');
    expect(result.titleCell).toBeNull();
  });

  it('sets leftCell to titleCell alone when no companyCell is available', async () => {
    setupWorkbook([
      [
        ['Full Title Without Company'],
        ['Código: DOC-999'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.leftCell).toBe('Full Title Without Company');
    expect(result.titleCell).toBe('Full Title Without Company');
  });

  it('skips cells with fewer than 2 characters', async () => {
    setupWorkbook([
      [
        ['X'],                   // 1 char — skipped
        ['Valid Title'],
        ['Código: DOC-001'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.titleCell).toBe('Valid Title');
  });

  it('deduplicates identical cell values across rows', async () => {
    setupWorkbook([
      [
        ['Policy Title'],
        ['Policy Title'],         // duplicate — deduplicated
        ['Código: POL-001'],
      ],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.titleCell).toBe('Policy Title');
    expect(result.rightCell).toContain('Código: POL-001');
  });

  it('only scans the first 10 rows for header detection', async () => {
    // 10 rows of filler, then a metadata row at row 11 (0-indexed row 10)
    const rows: any[][] = Array.from({ length: 10 }, (_, i) => [`Row ${i} filler`]);
    rows.push(['Código: LATE-001']);  // row index 10 — beyond the 10-row scan window

    setupWorkbook([rows]);

    const result = await parseXlsxStructured(buf);

    expect(result.rightCell).toBeNull();
  });

  it('includes all sheet text in the text field', async () => {
    setupWorkbook([
      [['Sheet 1 Title'], ['Código: S1-001']],
      [['Sheet 2 Content']],
    ]);

    const result = await parseXlsxStructured(buf);

    expect(result.text).toContain('Sheet 1 Title');
    expect(result.text).toContain('Código: S1-001');
    expect(result.text).toContain('Sheet 2 Content');
  });

  it('returns null for all cells when no header data is found', async () => {
    setupWorkbook([[[]]]);  // single sheet, single empty row

    const result = await parseXlsxStructured(buf);

    expect(result.titleCell).toBeNull();
    expect(result.leftCell).toBeNull();
    expect(result.rightCell).toBeNull();
  });
});
