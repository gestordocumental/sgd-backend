import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { BulkImportService } from './bulk-import.service';
import { CreationSource } from '../typologies/schemas/typology.schema';

// ── Excel workbook builder ─────────────────────────────────────────────────

async function buildExcel(
  rows: Array<[string, string?, string?, string?, string?, string?]>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Department', 'Area', 'Position', 'Nombre', 'Codigo', 'Version']); // header
  for (const row of rows) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── Mocks ─────────────────────────────────────────────────────────────────

function makeDeps(overrides: { typologiesService?: any; orgClient?: any } = {}) {
  const typologiesService = overrides.typologiesService ?? {
    create: jest.fn().mockResolvedValue({}),
  };
  const orgClient = overrides.orgClient ?? {
    resolveStructure: jest.fn().mockResolvedValue({
      resolved: [{
        index: 0,
        departamentoId: 'dept-1',
        areaId: null,
        cargoId: null,
      }],
      unresolved: [],
    }),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { typologiesService, orgClient, logger };
}

// ── BulkImportService ──────────────────────────────────────────────────────

describe('BulkImportService', () => {
  // ExcelJS uses JSZip internally (zip compression/decompression) which can be
  // slow in CI environments. Tests that build real workbooks need extra headroom.
  jest.setTimeout(30000);

  afterEach(() => jest.restoreAllMocks());

  it('imports valid rows successfully', async () => {
    const buffer = await buildExcel([
      ['IT', 'Dev', 'Engineer', 'Security Policy', 'POL-001', 'v1.0'],
    ]);
    const { typologiesService, orgClient, logger } = makeDeps();
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    const result = await service.importFromExcel('org-1', buffer);

    expect(result.totalRows).toBe(1);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(typologiesService.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ nombre: 'Security Policy', codigo: 'POL-001', version: 'v1.0' }),
      expect.any(Object),
      CreationSource.BULK_IMPORT,
    );
  });

  it('deduplicates structure combinations across rows', async () => {
    const buffer = await buildExcel([
      ['IT', undefined, undefined, 'Policy A', 'POL-001', 'v1.0'],
      ['IT', undefined, undefined, 'Policy B', 'POL-002', 'v1.0'],
    ]);
    const orgClient = {
      resolveStructure: jest.fn().mockResolvedValue({
        resolved: [{ index: 0, departamentoId: 'dept-1', areaId: null, cargoId: null }],
        unresolved: [],
      }),
    };
    const { typologiesService, logger } = makeDeps({ orgClient });
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    await service.importFromExcel('org-1', buffer);

    // resolveStructure should be called with only ONE unique structure item
    expect(orgClient.resolveStructure).toHaveBeenCalledWith(
      'org-1',
      expect.arrayContaining([expect.objectContaining({ department: 'IT' })]),
    );
    const callArg = orgClient.resolveStructure.mock.calls[0][1];
    expect(callArg).toHaveLength(1);
  });

  it('records failed rows when structure is unresolved', async () => {
    const buffer = await buildExcel([
      ['NONEXISTENT', undefined, undefined, 'Policy', 'POL-001', 'v1.0'],
    ]);
    const orgClient = {
      resolveStructure: jest.fn().mockResolvedValue({
        resolved:   [],
        unresolved: [{ index: 0, reason: 'Department not found' }],
      }),
    };
    const { typologiesService, logger } = makeDeps({ orgClient });
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    const result = await service.importFromExcel('org-1', buffer);

    expect(result.failed).toBe(1);
    expect(result.errors[0].reason).toBe('Department not found');
    expect(typologiesService.create).not.toHaveBeenCalled();
  });

  it('records failed rows when typologies.create() throws', async () => {
    const buffer = await buildExcel([
      ['IT', undefined, undefined, 'Policy', 'POL-DUP', 'v1.0'],
    ]);
    const typologiesService = {
      create: jest.fn().mockRejectedValue(new Error('Duplicate code')),
    };
    const { orgClient, logger } = makeDeps({ typologiesService });
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    const result = await service.importFromExcel('org-1', buffer);

    expect(result.failed).toBe(1);
    expect(result.errors[0].reason).toBe('Duplicate code');
  });

  it('skips rows missing required fields (department, nombre, codigo, version)', async () => {
    const buffer = await buildExcel([
      ['IT', undefined, undefined, undefined, undefined, undefined], // no typology data
      ['IT', undefined, undefined, 'Policy', 'POL-001', 'v1.0'],    // valid
    ]);
    const { typologiesService, orgClient, logger } = makeDeps();
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    const result = await service.importFromExcel('org-1', buffer);

    expect(result.totalRows).toBe(1); // only the valid row is counted
    expect(result.created).toBe(1);
  });

  it('throws BadRequestException when file has no valid rows', async () => {
    // Only header row, no data
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Department', 'Area', 'Position', 'Nombre', 'Codigo', 'Version']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const { typologiesService, orgClient, logger } = makeDeps();
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    await expect(service.importFromExcel('org-1', buf)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when row count exceeds 500', async () => {
    jest.spyOn(ExcelJS, 'Workbook').mockImplementationOnce(function () {
      return {
        xlsx: { load: jest.fn().mockResolvedValue(undefined) },
        worksheets: [{ rowCount: 502 }],
      };
    } as any);

    const { typologiesService, orgClient, logger } = makeDeps();
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    await expect(service.importFromExcel('org-1', Buffer.alloc(0))).rejects.toThrow(BadRequestException);
  });

  it('handles mixed resolved/failed rows correctly', async () => {
    const buffer = await buildExcel([
      ['IT',      undefined, undefined, 'Policy A', 'POL-001', 'v1.0'], // resolved
      ['MISSING', undefined, undefined, 'Policy B', 'POL-002', 'v1.0'], // unresolved
    ]);
    const orgClient = {
      resolveStructure: jest.fn().mockResolvedValue({
        resolved:   [{ index: 0, departamentoId: 'dept-1', areaId: null, cargoId: null }],
        unresolved: [{ index: 1, reason: 'Department MISSING not found' }],
      }),
    };
    const { typologiesService, logger } = makeDeps({ orgClient });
    const service = new BulkImportService(typologiesService as any, orgClient as any, logger as any);

    const result = await service.importFromExcel('org-1', buffer);

    expect(result.totalRows).toBe(2);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
  });
});
