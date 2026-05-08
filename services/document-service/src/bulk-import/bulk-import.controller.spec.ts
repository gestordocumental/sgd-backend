import { BadRequestException } from '@nestjs/common';
import { BulkImportController } from './bulk-import.controller';
import { BulkImportResponseDto } from './dto/bulk-import-response.dto';

// ── Helpers ─────────────────────────────────────────────────────────────────

const XLSX_MIME    = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME     = 'application/vnd.ms-excel';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'typologies.xlsx',
    encoding:     '7bit',
    mimetype:     XLSX_MIME,
    size:         4096,
    buffer:       Buffer.from('fake excel content'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeBulkImportResponse(overrides: Partial<BulkImportResponseDto> = {}): BulkImportResponseDto {
  return {
    totalRows: 3,
    created:   3,
    failed:    0,
    errors:    [],
    ...overrides,
  } as BulkImportResponseDto;
}

function makeService(response = makeBulkImportResponse()) {
  return {
    importFromExcel: jest.fn().mockResolvedValue(response),
  };
}

// ── BulkImportController ─────────────────────────────────────────────────────

describe('BulkImportController', () => {

  describe('bulkImport()', () => {
    it('delegates to service.importFromExcel with orgId and file buffer', async () => {
      const service = makeService();
      const ctrl    = new BulkImportController(service as any);
      const file    = makeFile();

      const result = await ctrl.bulkImport('org-1', file);

      expect(service.importFromExcel).toHaveBeenCalledWith('org-1', file.buffer);
      expect(result).toMatchObject({ totalRows: 3, created: 3, failed: 0 });
    });

    it('throws BadRequestException when no file is provided', async () => {
      const service = makeService();
      const ctrl    = new BulkImportController(service as any);

      await expect(ctrl.bulkImport('org-1', undefined as any)).rejects.toThrow(BadRequestException);
      expect(service.importFromExcel).not.toHaveBeenCalled();
    });

    it('accepts an XLS file (application/vnd.ms-excel)', async () => {
      const service = makeService();
      const ctrl    = new BulkImportController(service as any);
      const file    = makeFile({ mimetype: XLS_MIME, originalname: 'data.xls' });

      const result = await ctrl.bulkImport('org-1', file);

      expect(service.importFromExcel).toHaveBeenCalledWith('org-1', file.buffer);
      expect(result).toBeDefined();
    });

    it('propagates errors from service.importFromExcel', async () => {
      const service = makeService();
      service.importFromExcel.mockRejectedValue(new BadRequestException('El archivo Excel es inválido'));
      const ctrl = new BulkImportController(service as any);

      await expect(ctrl.bulkImport('org-1', makeFile())).rejects.toThrow('El archivo Excel es inválido');
    });

    it('returns correct shape when some rows fail', async () => {
      const response = makeBulkImportResponse({
        totalRows: 3,
        created:   2,
        failed:    1,
        errors:    [{ row: 2, reason: 'Department not found' }] as any,
      });
      const service = makeService(response);
      const ctrl    = new BulkImportController(service as any);

      const result = await ctrl.bulkImport('org-1', makeFile());

      expect(result.created).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('passes the correct orgId to service.importFromExcel', async () => {
      const service = makeService();
      const ctrl    = new BulkImportController(service as any);

      await ctrl.bulkImport('my-special-org', makeFile());

      expect(service.importFromExcel).toHaveBeenCalledWith('my-special-org', expect.any(Buffer));
    });

    it('passes the file buffer (not the whole file object) to service', async () => {
      const service = makeService();
      const ctrl    = new BulkImportController(service as any);
      const buffer  = Buffer.from('excel data');
      const file    = makeFile({ buffer });

      await ctrl.bulkImport('org-1', file);

      expect(service.importFromExcel).toHaveBeenCalledWith('org-1', buffer);
    });
  });
});
