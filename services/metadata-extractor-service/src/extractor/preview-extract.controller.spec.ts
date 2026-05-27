import { BadRequestException } from '@nestjs/common';
import { PreviewExtractController } from './preview-extract.controller';

// ── Module-level mock for parser.factory ──────────────────────────────────────

jest.mock('./parsers/parser.factory', () => ({
  extractStructured: jest.fn(),
}));

import { extractStructured } from './parsers/parser.factory';

const mockExtractStructured = extractStructured as jest.MockedFunction<typeof extractStructured>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype:     'application/pdf',
    size:         1024,
    buffer:       Buffer.from('fake pdf content'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeRules(overrides: Partial<{ extract: jest.Mock }> = {}) {
  return {
    extract: jest.fn().mockReturnValue({ nombre: 'Security Policy', codigo: 'POL-001', version: '1.0' }),
    ...overrides,
  };
}

// ── PreviewExtractController ──────────────────────────────────────────────────

describe('PreviewExtractController', () => {

  beforeEach(() => {
    mockExtractStructured.mockReset();
  });

  it('throws BadRequestException when no file is provided', async () => {
    const ctrl = new PreviewExtractController(makeRules() as any);
    await expect(ctrl.extract(undefined as any)).rejects.toThrow(BadRequestException);
  });

  it('returns null fields when MIME type is not supported (extractStructured returns null)', async () => {
    mockExtractStructured.mockResolvedValue(null);
    const rules = makeRules();
    const ctrl  = new PreviewExtractController(rules as any);

    const result = await ctrl.extract(makeFile({ mimetype: 'image/jpeg' }));

    expect(result).toEqual({ nombre: null, codigo: null, version: null });
    expect(rules.extract).not.toHaveBeenCalled();
  });

  it('returns null fields when document text is empty', async () => {
    mockExtractStructured.mockResolvedValue({
      text: '   ', titleCell: null, leftCell: null, rightCell: null,
    });
    const rules = makeRules();
    const ctrl  = new PreviewExtractController(rules as any);

    const result = await ctrl.extract(makeFile());

    expect(result).toEqual({ nombre: null, codigo: null, version: null });
    expect(rules.extract).not.toHaveBeenCalled();
  });

  it('delegates to rules.extract and returns the result', async () => {
    mockExtractStructured.mockResolvedValue({
      text:      'Security Policy document content POL-001 version 1.0',
      titleCell: 'Security Policy',
      leftCell:  null,
      rightCell: 'Código: POL-001\nVersión: 1.0',
    });
    const rules = makeRules();
    const ctrl  = new PreviewExtractController(rules as any);

    const result = await ctrl.extract(makeFile(), 'Helisa SAS');

    expect(extractStructured).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
    expect(rules.extract).toHaveBeenCalledWith({
      text:      'Security Policy document content POL-001 version 1.0',
      titleCell: 'Security Policy',
      leftCell:  null,
      rightCell: 'Código: POL-001\nVersión: 1.0',
      orgName:   'Helisa SAS',
    });
    expect(result).toEqual({ nombre: 'Security Policy', codigo: 'POL-001', version: '1.0' });
  });

  it('passes null orgName when orgName is not provided', async () => {
    mockExtractStructured.mockResolvedValue({
      text: 'Document content here', titleCell: null, leftCell: null, rightCell: null,
    });
    const rules = makeRules();
    const ctrl  = new PreviewExtractController(rules as any);

    await ctrl.extract(makeFile());

    expect(rules.extract).toHaveBeenCalledWith(expect.objectContaining({ orgName: null }));
  });

  it('passes file buffer and mimetype to extractStructured', async () => {
    const buffer   = Buffer.from('docx content');
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    mockExtractStructured.mockResolvedValue({
      text: 'DOCX content here', titleCell: null, leftCell: null, rightCell: null,
    });
    const ctrl = new PreviewExtractController(makeRules() as any);

    await ctrl.extract(makeFile({ buffer, mimetype: mimeType }));

    expect(extractStructured).toHaveBeenCalledWith(buffer, mimeType);
  });
});
