import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BulkStructureService } from './bulk-structure.service';
import { Departamento } from './entities/departamento.entity';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { AppLogger } from '@sgd/common';

// ─── ExcelJS mock ─────────────────────────────────────────────────────────────
type RowCallback = (row: { getCell: (n: number) => { text: string } }, rowNumber: number) => void;

const mockEachRow = jest.fn();
const mockGetWorksheet = jest.fn();

jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    xlsx: { load: jest.fn().mockResolvedValue(undefined) },
    getWorksheet: mockGetWorksheet,
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ORG_ID = 'org-uuid-0001';

const makeDept = (overrides: Partial<Departamento> = {}): Departamento =>
  ({
    id: 'dept-uuid-0001',
    orgId: ORG_ID,
    name: 'Engineering',
    description: null,
    areas: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }) as Departamento;

const makeArea = (overrides: Partial<Area> = {}): Area =>
  ({
    id: 'area-uuid-0001',
    orgId: ORG_ID,
    departamentoId: 'dept-uuid-0001',
    name: 'Backend',
    description: null,
    departamento: {} as Departamento,
    cargos: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }) as Area;

const makeCargo = (overrides: Partial<Cargo> = {}): Cargo =>
  ({
    id: 'cargo-uuid-0001',
    orgId: ORG_ID,
    areaId: 'area-uuid-0001',
    departamentoId: 'dept-uuid-0001',
    name: 'Senior Dev',
    description: null,
    area: {} as Area,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }) as Cargo;

/** Build a fake worksheet that calls eachRow with the given rows */
const makeWorksheet = (
  rows: Array<{ cells: string[] }>,
) => ({
  eachRow: (cb: RowCallback) => {
    // row 1 = header
    cb({ getCell: (n: number) => ({ text: `H${n}` }) }, 1);
    rows.forEach((row, idx) => {
      cb(
        { getCell: (n: number) => ({ text: row.cells[n - 1] ?? '' }) },
        idx + 2,
      );
    });
  },
});

type MockRepo<T extends object> = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

describe('BulkStructureService', () => {
  let service: BulkStructureService;
  let deptRepo: MockRepo<Departamento>;
  let areaRepo: MockRepo<Area>;
  let cargoRepo: MockRepo<Cargo>;
  let mockLogger: jest.Mocked<AppLogger>;

  beforeEach(async () => {
    deptRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    areaRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    cargoRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    mockLogger = {
      log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkStructureService,
        { provide: getRepositoryToken(Departamento), useValue: deptRepo },
        { provide: getRepositoryToken(Area), useValue: areaRepo },
        { provide: getRepositoryToken(Cargo), useValue: cargoRepo },
        { provide: AppLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(BulkStructureService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── importFromExcel ────────────────────────────────────────────────────────

  describe('importFromExcel()', () => {
    it('throws BadRequestException when no "Estructura" worksheet is found', async () => {
      mockGetWorksheet.mockReturnValue(undefined);

      await expect(service.importFromExcel(ORG_ID, Buffer.from(''))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the worksheet has no valid rows', async () => {
      mockGetWorksheet.mockReturnValue(makeWorksheet([]));

      await expect(service.importFromExcel(ORG_ID, Buffer.from(''))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when row count exceeds 500', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({
        cells: [`Dept${i}`, '', '', '', '', ''],
      }));
      mockGetWorksheet.mockReturnValue(makeWorksheet(rows));
      // All depts are "new"
      deptRepo.findOne.mockResolvedValue(null);
      deptRepo.create.mockImplementation((d: any) => d);
      deptRepo.save.mockImplementation((d: any) => Promise.resolve({ ...d, id: 'new-id' }));

      await expect(service.importFromExcel(ORG_ID, Buffer.from(''))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a new department when it does not exist', async () => {
      const dept = makeDept();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', 'Tech dept', '', '', '', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(null);
      deptRepo.create.mockReturnValue(dept);
      deptRepo.save.mockResolvedValue(dept);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.departmentsCreated).toBe(1);
      expect(result.departmentsExisting).toBe(0);
      expect(result.totalRows).toBe(1);
    });

    it('counts an existing department without creating it', async () => {
      const dept = makeDept();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', '', '', '', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.departmentsExisting).toBe(1);
      expect(result.departmentsCreated).toBe(0);
      expect(deptRepo.save).not.toHaveBeenCalled();
    });

    it('creates a new area under an existing department', async () => {
      const dept = makeDept();
      const area = makeArea();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', 'Backend', '', '', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(null);
      areaRepo.create.mockReturnValue(area);
      areaRepo.save.mockResolvedValue(area);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.areasCreated).toBe(1);
      expect(result.areasExisting).toBe(0);
    });

    it('counts an existing area without creating it', async () => {
      const dept = makeDept();
      const area = makeArea();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', 'Backend', '', '', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.areasExisting).toBe(1);
      expect(result.areasCreated).toBe(0);
    });

    it('creates a new position under an existing area', async () => {
      const dept = makeDept();
      const area = makeArea();
      const cargo = makeCargo();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', 'Backend', '', 'Senior Dev', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);
      cargoRepo.findOne.mockResolvedValue(null);
      cargoRepo.create.mockReturnValue(cargo);
      cargoRepo.save.mockResolvedValue(cargo);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.positionsCreated).toBe(1);
      expect(result.positionsExisting).toBe(0);
    });

    it('counts an existing position without creating it', async () => {
      const dept = makeDept();
      const area = makeArea();
      const cargo = makeCargo();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', 'Backend', '', 'Senior Dev', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);
      cargoRepo.findOne.mockResolvedValue(cargo);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.positionsExisting).toBe(1);
      expect(result.positionsCreated).toBe(0);
    });

    it('creates a dept-level position when no area is provided', async () => {
      const dept = makeDept();
      const cargo = makeCargo({ areaId: null });
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', '', '', 'Senior Dev', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      cargoRepo.findOne.mockResolvedValue(null);
      cargoRepo.create.mockReturnValue(cargo);
      cargoRepo.save.mockResolvedValue(cargo);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.failed).toBe(0);
      expect(result.positionsCreated).toBe(1);
    });

    it('records a generic error and logs a warning when an unexpected exception is thrown', async () => {
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', '', '', '', ''] }]),
      );
      deptRepo.findOne.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.failed).toBe(1);
      expect(result.errors[0].reason).toBe('No se pudo procesar la fila');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('records the BadRequestException message when one is thrown during processing', async () => {
      const dept = makeDept();
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([{ cells: ['Engineering', '', 'Backend', '', '', ''] }]),
      );
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockRejectedValue(new BadRequestException('Custom bad request'));

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      expect(result.errors[0].reason).toBe('Custom bad request');
    });

    it('skips rows where the department cell is empty', async () => {
      mockGetWorksheet.mockReturnValue(
        makeWorksheet([
          { cells: ['', '', '', '', '', ''] }, // empty row — skipped
          { cells: ['Engineering', '', '', '', '', ''] },
        ]),
      );
      deptRepo.findOne.mockResolvedValue(null);
      const dept = makeDept();
      deptRepo.create.mockReturnValue(dept);
      deptRepo.save.mockResolvedValue(dept);

      const result = await service.importFromExcel(ORG_ID, Buffer.from(''));

      // Only one non-empty row processed
      expect(result.totalRows).toBe(1);
    });
  });

  // ─── resolveStructure ──────────────────────────────────────────────────────

  describe('resolveStructure()', () => {
    it('throws BadRequestException when items exceed 500', async () => {
      const dto = {
        orgId: ORG_ID,
        items: Array.from({ length: 501 }, (_, i) => ({ department: `Dept${i}` })),
      };

      await expect(service.resolveStructure(dto as any)).rejects.toThrow(BadRequestException);
    });

    it('resolves a department-only item', async () => {
      const dept = makeDept();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering' }],
      });

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]).toMatchObject({
        index: 0,
        departamentoId: dept.id,
        areaId: null,
        cargoId: null,
      });
      expect(result.unresolved).toHaveLength(0);
    });

    it('returns an unresolved item when the department is not found', async () => {
      deptRepo.find.mockResolvedValue([]);
      areaRepo.find.mockResolvedValue([]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Missing' }],
      });

      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0].reason).toContain('Missing');
    });

    it('returns unresolved when dept-level position is not found', async () => {
      const dept = makeDept();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering', position: 'Dev' }],
      });

      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0].reason).toContain('Dev');
    });

    it('resolves department + area', async () => {
      const dept = makeDept();
      const area = makeArea();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([area]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering', area: 'Backend' }],
      });

      expect(result.resolved[0]).toMatchObject({
        departamentoId: dept.id,
        areaId: area.id,
        cargoId: null,
      });
    });

    it('returns unresolved when area is not found', async () => {
      const dept = makeDept();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering', area: 'Unknown' }],
      });

      expect(result.unresolved[0].reason).toContain('Unknown');
    });

    it('resolves department + area + position', async () => {
      const dept = makeDept();
      const area = makeArea();
      const cargo = makeCargo();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([area]);
      cargoRepo.find.mockResolvedValue([cargo]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering', area: 'Backend', position: 'Senior Dev' }],
      });

      expect(result.resolved[0]).toMatchObject({
        departamentoId: dept.id,
        areaId: area.id,
        cargoId: cargo.id,
      });
    });

    it('returns unresolved when position (cargo) is not found', async () => {
      const dept = makeDept();
      const area = makeArea();
      deptRepo.find.mockResolvedValue([dept]);
      areaRepo.find.mockResolvedValue([area]);
      cargoRepo.find.mockResolvedValue([]);

      const result = await service.resolveStructure({
        orgId: ORG_ID,
        items: [{ department: 'Engineering', area: 'Backend', position: 'Ghost' }],
      });

      expect(result.unresolved[0].reason).toContain('Ghost');
    });
  });

  // ─── resolveStructureById ─────────────────────────────────────────────────

  describe('resolveStructureById()', () => {
    it('resolves department-only when no areaId or cargoId supplied', async () => {
      const dept = makeDept();
      deptRepo.findOne.mockResolvedValue(dept);

      const result = await service.resolveStructureById({
        orgId: ORG_ID,
        departamentoId: dept.id,
      });

      expect(result).toMatchObject({
        departamentoId: dept.id,
        departamentoNombre: dept.name,
        areaId: null,
        areaNombre: null,
        cargoId: null,
        cargoNombre: null,
      });
    });

    it('throws BadRequestException when department is not found', async () => {
      deptRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveStructureById({ orgId: ORG_ID, departamentoId: 'missing-dept' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cargoId is given without areaId', async () => {
      const dept = makeDept();
      deptRepo.findOne.mockResolvedValue(dept);

      await expect(
        service.resolveStructureById({
          orgId: ORG_ID,
          departamentoId: dept.id,
          cargoId: 'some-cargo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves department + area when areaId is provided', async () => {
      const dept = makeDept();
      const area = makeArea();
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);

      const result = await service.resolveStructureById({
        orgId: ORG_ID,
        departamentoId: dept.id,
        areaId: area.id,
      });

      expect(result).toMatchObject({
        departamentoId: dept.id,
        areaId: area.id,
        areaNombre: area.name,
        cargoId: null,
        cargoNombre: null,
      });
    });

    it('throws BadRequestException when area is not found', async () => {
      const dept = makeDept();
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveStructureById({
          orgId: ORG_ID,
          departamentoId: dept.id,
          areaId: 'missing-area',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves department + area + cargo when all IDs are provided', async () => {
      const dept = makeDept();
      const area = makeArea();
      const cargo = makeCargo();
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);
      cargoRepo.findOne.mockResolvedValue(cargo);

      const result = await service.resolveStructureById({
        orgId: ORG_ID,
        departamentoId: dept.id,
        areaId: area.id,
        cargoId: cargo.id,
      });

      expect(result).toMatchObject({
        areaId: area.id,
        cargoId: cargo.id,
        cargoNombre: cargo.name,
      });
    });

    it('throws BadRequestException when cargo is not found', async () => {
      const dept = makeDept();
      const area = makeArea();
      deptRepo.findOne.mockResolvedValue(dept);
      areaRepo.findOne.mockResolvedValue(area);
      cargoRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveStructureById({
          orgId: ORG_ID,
          departamentoId: dept.id,
          areaId: area.id,
          cargoId: 'missing-cargo',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
