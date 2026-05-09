import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BulkStructureController } from './bulk-structure.controller';
import { InternalStructureController } from './internal-structure.controller';
import { BulkStructureService } from './bulk-structure.service';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { InternalGuard } from '../common/guards/internal.guard';

const ORG_ID = 'b3a7c1d0-0000-4000-a000-000000000001';

const makeFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    buffer: Buffer.from('fake-excel-content'),
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    originalname: 'structure.xlsx',
    size: 1024,
    ...overrides,
  }) as Express.Multer.File;

const makeBulkResponse = () => ({
  totalRows: 3,
  departmentsCreated: 2,
  departmentsExisting: 1,
  areasCreated: 1,
  areasExisting: 0,
  positionsCreated: 1,
  positionsExisting: 0,
  failed: 0,
  errors: [],
});

describe('BulkStructureController', () => {
  let controller: BulkStructureController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      importFromExcel: jest.fn(),
      resolveStructure: jest.fn(),
      resolveStructureById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulkStructureController],
      providers: [{ provide: BulkStructureService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(BulkStructureController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('bulkImport()', () => {
    it('delegates to service.importFromExcel and returns the result', async () => {
      const response = makeBulkResponse();
      service.importFromExcel.mockResolvedValue(response);
      const file = makeFile();

      const result = await controller.bulkImport(ORG_ID, file);

      expect(service.importFromExcel).toHaveBeenCalledWith(ORG_ID, file.buffer);
      expect(result).toBe(response);
    });

    it('throws BadRequestException when no file is uploaded', async () => {
      await expect(
        controller.bulkImport(ORG_ID, undefined as any),
      ).rejects.toThrow(BadRequestException);

      expect(service.importFromExcel).not.toHaveBeenCalled();
    });

    it('propagates exceptions thrown by the service', async () => {
      service.importFromExcel.mockRejectedValue(
        new BadRequestException('No se encontró la hoja "Estructura"'),
      );

      await expect(controller.bulkImport(ORG_ID, makeFile())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uses the orgId from the route parameter', async () => {
      const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      service.importFromExcel.mockResolvedValue(makeBulkResponse());

      await controller.bulkImport(otherId, makeFile());

      expect(service.importFromExcel).toHaveBeenCalledWith(otherId, expect.any(Buffer));
    });
  });
});

describe('InternalStructureController', () => {
  let controller: InternalStructureController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      importFromExcel: jest.fn(),
      resolveStructure: jest.fn(),
      resolveStructureById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalStructureController],
      providers: [{ provide: BulkStructureService, useValue: service }],
    })
      .overrideGuard(InternalGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(InternalStructureController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolve()', () => {
    it('delegates to service.resolveStructure and returns the result', async () => {
      const dto = {
        orgId: ORG_ID,
        items: [{ department: 'Engineering', area: 'Backend', position: 'Senior Dev' }],
      };
      const response = {
        resolved: [{ index: 0, departamentoId: 'dept-1', areaId: 'area-1', cargoId: 'cargo-1' }],
        unresolved: [],
      };
      service.resolveStructure.mockResolvedValue(response);

      const result = await controller.resolve(dto as any);

      expect(service.resolveStructure).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });

    it('returns mixed resolved and unresolved results', async () => {
      const dto = {
        orgId: ORG_ID,
        items: [
          { department: 'Engineering' },
          { department: 'NonExistent' },
        ],
      };
      const response = {
        resolved: [{ index: 0, departamentoId: 'dept-1', areaId: null, cargoId: null }],
        unresolved: [{ index: 1, reason: "Departamento 'NonExistent' no encontrado." }],
      };
      service.resolveStructure.mockResolvedValue(response);

      const result = await controller.resolve(dto as any);

      expect(result.resolved).toHaveLength(1);
      expect(result.unresolved).toHaveLength(1);
    });

    it('propagates BadRequestException from the service', async () => {
      service.resolveStructure.mockRejectedValue(
        new BadRequestException('La solicitud excede el máximo de 500 elementos'),
      );

      await expect(
        controller.resolve({ orgId: ORG_ID, items: [] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveById()', () => {
    it('delegates to service.resolveStructureById and returns the result', async () => {
      const dto = {
        orgId: ORG_ID,
        departamentoId: 'dept-uuid-001',
        areaId: 'area-uuid-001',
        cargoId: 'cargo-uuid-001',
      };
      const response = {
        departamentoId: 'dept-uuid-001',
        departamentoNombre: 'Engineering',
        areaId: 'area-uuid-001',
        areaNombre: 'Backend',
        cargoId: 'cargo-uuid-001',
        cargoNombre: 'Senior Dev',
      };
      service.resolveStructureById.mockResolvedValue(response);

      const result = await controller.resolveById(dto as any);

      expect(service.resolveStructureById).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });

    it('resolves with only department when no areaId is given', async () => {
      const dto = { orgId: ORG_ID, departamentoId: 'dept-uuid-001' };
      const response = {
        departamentoId: 'dept-uuid-001',
        departamentoNombre: 'Engineering',
        areaId: null,
        areaNombre: null,
        cargoId: null,
        cargoNombre: null,
      };
      service.resolveStructureById.mockResolvedValue(response);

      const result = await controller.resolveById(dto as any);

      expect(result).toEqual(response);
    });

    it('propagates BadRequestException from the service', async () => {
      service.resolveStructureById.mockRejectedValue(
        new BadRequestException("Departamento 'missing' no encontrado en la organización"),
      );

      await expect(
        controller.resolveById({ orgId: ORG_ID, departamentoId: 'missing' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
