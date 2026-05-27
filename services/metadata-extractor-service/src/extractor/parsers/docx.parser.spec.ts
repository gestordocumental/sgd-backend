import { parseDocx, parseDocxStructured, DocxStructure } from './docx.parser';

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockExtractRawText = jest.fn();

jest.mock('mammoth', () => ({
  extractRawText: (...args: any[]) => mockExtractRawText(...args),
}));

const mockLoadAsync = jest.fn();

jest.mock('jszip', () => {
  const mockConstructor = { loadAsync: (...args: any[]) => mockLoadAsync(...args) };
  return mockConstructor;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const buf = Buffer.from('fake docx bytes');

/** Builds a minimal ZIP mock with arbitrary header XML for each header file. */
function makeZipMock(headerContents: Partial<Record<string, string>> = {}): any {
  const files: Record<string, any> = {};
  for (const [filename, content] of Object.entries(headerContents)) {
    files[filename] = { async: jest.fn().mockResolvedValue(content) };
  }
  return { files };
}

// A minimal OOXML table with two non-vMerge cells
function makeTableXml(cells: string[]): string {
  const cellXml = cells
    .map(
      (text) =>
        `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`,
    )
    .join('');
  return `<w:tbl>${cellXml}</w:tbl>`;
}

// ── parseDocx() ───────────────────────────────────────────────────────────────

describe('parseDocx()', () => {
  beforeEach(() => {
    mockExtractRawText.mockReset();
  });

  it('returns extracted text from a valid DOCX buffer', async () => {
    mockExtractRawText.mockResolvedValue({ value: 'DOCX plain text' });

    const result = await parseDocx(buf);

    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: buf });
    expect(result).toBe('DOCX plain text');
  });

  it('returns empty string when mammoth returns undefined value', async () => {
    mockExtractRawText.mockResolvedValue({ value: undefined });

    const result = await parseDocx(buf);

    expect(result).toBe('');
  });

  it('returns empty string when mammoth throws', async () => {
    mockExtractRawText.mockRejectedValue(new Error('Invalid DOCX'));

    const result = await parseDocx(buf);

    expect(result).toBe('');
  });

  it('returns empty string on non-Error rejection', async () => {
    mockExtractRawText.mockRejectedValue('unexpected string error');

    const result = await parseDocx(buf);

    expect(result).toBe('');
  });
});

// ── parseDocxStructured() ────────────────────────────────────────────────────

describe('parseDocxStructured()', () => {
  beforeEach(() => {
    mockExtractRawText.mockReset();
    mockLoadAsync.mockReset();
    mockExtractRawText.mockResolvedValue({ value: 'Full document text' });
  });

  it('returns text with null cells when no header XML files are present', async () => {
    mockLoadAsync.mockResolvedValue(makeZipMock());

    const result = await parseDocxStructured(buf);

    expect(result).toEqual<DocxStructure>({
      text:      'Full document text',
      titleCell: null,
      rightCell: null,
      leftCell:  null,
    });
  });

  it('returns text with null cells when header XML has no table', async () => {
    mockLoadAsync.mockResolvedValue(
      makeZipMock({ 'word/header2.xml': '<w:hdr><w:p><w:r><w:t>No table here</w:t></w:r></w:p></w:hdr>' }),
    );

    const result = await parseDocxStructured(buf);

    expect(result.titleCell).toBeNull();
    expect(result.rightCell).toBeNull();
  });

  it('extracts metadata cell (rightCell) when it contains Código/Versión', async () => {
    const xml = makeTableXml(['Security Policy', 'Código: POL-001\nVersión: 1.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    expect(result.rightCell).toContain('Código: POL-001');
    expect(result.text).toBe('Full document text');
  });

  it('identifies titleCell as the non-company, non-metadata cell', async () => {
    const xml = makeTableXml(['Security Policy Manual', 'Código: POL-001\nVersión: 1.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    expect(result.titleCell).toBe('Security Policy Manual');
  });

  it('identifies company cell (all-caps short text) and sets leftCell', async () => {
    const xml = makeTableXml(['ACME CORP', 'Document Title', 'Código: POL-001\nVersión: 1.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    // Company cell (ACME CORP) + title cell combined in leftCell
    expect(result.leftCell).toContain('ACME CORP');
    expect(result.leftCell).toContain('Document Title');
  });

  it('identifies company cell with legal suffix (S.A.S)', async () => {
    const xml = makeTableXml(['Helisa S.A.S', 'HR Onboarding', 'Código: HR-001\nVersión: 2.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    expect(result.leftCell).toContain('Helisa S.A.S');
    expect(result.titleCell).toBe('HR Onboarding');
  });

  it('falls back to header1.xml when header2.xml is absent', async () => {
    const xml = makeTableXml(['Policy Title', 'Código: POL-002\nVersión: 3.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header1.xml': xml }));

    const result = await parseDocxStructured(buf);

    expect(result.rightCell).toContain('Código: POL-002');
    expect(result.titleCell).toBe('Policy Title');
  });

  it('falls back to header3.xml when header1 and header2 are absent', async () => {
    const xml = makeTableXml(['Procedure Name', 'Versión: 4.0']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header3.xml': xml }));

    const result = await parseDocxStructured(buf);

    expect(result.rightCell).toContain('Versión: 4.0');
  });

  it('skips vMerge continuation cells', async () => {
    const xml = `<w:tbl>
      <w:tc><w:p><w:r><w:t>Real Cell</w:t></w:r></w:p></w:tc>
      <w:tc><w:vMerge /><w:p><w:r><w:t>Merged continuation</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Código: POL-001</w:t></w:r></w:p></w:tc>
    </w:tbl>`;
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    // The vMerge continuation cell text should not appear as its own cell
    expect(result.rightCell).toContain('Código: POL-001');
    expect(result.titleCell).toBe('Real Cell');
  });

  it('skips watermark cells (USO INTERNO)', async () => {
    const xml = makeTableXml(['USO INTERNO', 'Real Title', 'Código: INT-001']);
    mockLoadAsync.mockResolvedValue(makeZipMock({ 'word/header2.xml': xml }));

    const result = await parseDocxStructured(buf);

    // Watermark cell must be excluded; rightCell has the code, titleCell has the title
    expect(result.rightCell).toContain('Código: INT-001');
    expect(result.titleCell).toBe('Real Title');
  });

  it('returns null cells and text when JSZip.loadAsync throws', async () => {
    mockLoadAsync.mockRejectedValue(new Error('Not a zip file'));

    const result = await parseDocxStructured(buf);

    expect(result).toEqual<DocxStructure>({
      text:      'Full document text',
      titleCell: null,
      rightCell: null,
      leftCell:  null,
    });
  });

  it('returns empty string for text when mammoth also throws', async () => {
    mockExtractRawText.mockRejectedValue(new Error('Invalid DOCX'));
    mockLoadAsync.mockRejectedValue(new Error('Not a zip'));

    const result = await parseDocxStructured(buf);

    expect(result.text).toBe('');
    expect(result.titleCell).toBeNull();
  });

  it('prefers header2.xml over header1.xml when both exist', async () => {
    const xml2 = makeTableXml(['Title From Header2', 'Código: H2-001']);
    const xml1 = makeTableXml(['Title From Header1', 'Código: H1-001']);
    mockLoadAsync.mockResolvedValue(
      makeZipMock({ 'word/header2.xml': xml2, 'word/header1.xml': xml1 }),
    );

    const result = await parseDocxStructured(buf);

    expect(result.rightCell).toContain('H2-001');
    expect(result.titleCell).toBe('Title From Header2');
  });
});
