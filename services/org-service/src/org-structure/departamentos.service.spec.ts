import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { DepartamentosService } from './departamentos.service';
import { Departamento } from './entities/departamento.entity';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { KafkaProducerService } from '@sgd/common';

type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const makeDepartamento = (overrides: Partial<Departamento> = {}): Departamento => ({
  id: '4a28df02-8c9b-4d0b-aefa-a94f59d74ca1',
  orgId: '3fd98787-65f2-4f8a-a91d-23112e5e1a20',
  name: 'Finanzas',
  description: 'Gestion financiera',
  areas: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Departamento);

describe('DepartamentosService', () => {
  let service: DepartamentosService;
  let repo: MockRepo<Departamento>;
  let areaRepo: MockRepo<Area>;
  let cargoRepo: MockRepo<Cargo>;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
    };
    // Defaults to "no dependents" so every remove()/restore() test not
    // specifically about the dependency guard doesn't have to opt in.
    areaRepo = { count: jest.fn().mockResolvedValue(0) };
    cargoRepo = { count: jest.fn().mockResolvedValue(0) };
    // remove() runs inside a transaction now (see areas.service.ts /
    // departamentos.service.ts race-condition fix); this fakes .transaction()
    // by handing the callback a manager whose getRepository() resolves back
    // to the same mocks above, so existing assertions on repo/areaRepo/
    // cargoRepo keep working unchanged.
    const dataSource = {
      transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
        cb({
          getRepository: (entity: unknown) => {
            if (entity === Departamento) return repo;
            if (entity === Area) return areaRepo;
            if (entity === Cargo) return cargoRepo;
            throw new Error('unexpected entity in mock transaction manager');
          },
        } as unknown as EntityManager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartamentosService,
        { provide: getRepositoryToken(Departamento), useValue: repo },
        { provide: getRepositoryToken(Area), useValue: areaRepo },
        { provide: getRepositoryToken(Cargo), useValue: cargoRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: KafkaProducerService, useValue: { emitSafe: jest.fn() } },
      ],
    }).compile();

    service = module.get(DepartamentosService);
  });

  it('creates a departamento when name is unique inside the org', async () => {
    const dto = { name: 'Finanzas', description: 'Gestion financiera' };
    const departamento = makeDepartamento();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(departamento);
    repo.save!.mockResolvedValue(departamento);

    const result = await service.create(departamento.orgId, dto);

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { orgId: departamento.orgId, name: dto.name },
    });
    expect(result).toBe(departamento);
  });

  it('throws ConflictException when creating a duplicated departamento', async () => {
    repo.findOne!.mockResolvedValue(makeDepartamento());

    await expect(service.create('org-1', { name: 'Finanzas' })).rejects.toThrow(ConflictException);
  });

  it('returns all departamentos ordered by name', async () => {
    const departamentos = [makeDepartamento()];
    repo.find!.mockResolvedValue(departamentos);

    await expect(service.findAll('org-1')).resolves.toEqual(departamentos);
    expect(repo.find).toHaveBeenCalledWith({
      where: { orgId: 'org-1' },
      order: { name: 'ASC' },
      take: 500,
    });
  });

  it('returns one departamento by org and id', async () => {
    const departamento = makeDepartamento();
    repo.findOne!.mockResolvedValue(departamento);

    await expect(service.findOne(departamento.orgId, departamento.id)).resolves.toBe(departamento);
  });

  it('throws NotFoundException when departamento is missing', async () => {
    repo.findOne!.mockResolvedValue(null);

    await expect(service.findOne('org-1', 'dep-1')).rejects.toThrow(NotFoundException);
  });

  it('updates a departamento', async () => {
    const departamento = makeDepartamento();
    const saved = makeDepartamento({ name: 'Tesoreria' });
    repo.findOne!
      .mockResolvedValueOnce(departamento)
      .mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    const result = await service.update(departamento.orgId, departamento.id, { name: 'Tesoreria' });

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tesoreria' }));
    expect(result).toBe(saved);
  });

  it('throws ConflictException when updating to an existing departamento name', async () => {
    repo.findOne!
      .mockResolvedValueOnce(makeDepartamento())
      .mockResolvedValueOnce(makeDepartamento({ id: 'other' }));

    await expect(service.update('org-1', 'dep-1', { name: 'Duplicado' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('soft deletes a departamento with no areas or cargos', async () => {
    const departamento = makeDepartamento();
    repo.findOne!.mockResolvedValue(departamento);

    await service.remove(departamento.orgId, departamento.id);

    expect(areaRepo.count).toHaveBeenCalledWith({ where: { departamentoId: departamento.id } });
    expect(cargoRepo.count).toHaveBeenCalledWith({ where: { departamentoId: departamento.id } });
    expect(repo.softRemove).toHaveBeenCalledWith(departamento);
  });

  it('throws ConflictException instead of deleting a departamento that still has areas', async () => {
    // Regression: softRemove() issues an UPDATE, so the entity's
    // onDelete: 'RESTRICT' FK constraint (which only fires on a real SQL
    // DELETE) never protected against this — deletion used to silently
    // succeed and orphan the areas.
    const departamento = makeDepartamento();
    repo.findOne!.mockResolvedValue(departamento);
    areaRepo.count!.mockResolvedValue(2);

    await expect(service.remove(departamento.orgId, departamento.id)).rejects.toMatchObject({
      response: { errorCode: 'DEPARTMENT_HAS_DEPENDENCIES' },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('throws ConflictException instead of deleting a departamento that still has department-level cargos', async () => {
    // Department-level cargos (areaId: null) have no area to be blocked by,
    // so this must be checked independently of the areas count.
    const departamento = makeDepartamento();
    repo.findOne!.mockResolvedValue(departamento);
    cargoRepo.count!.mockResolvedValue(1);

    await expect(service.remove(departamento.orgId, departamento.id)).rejects.toMatchObject({
      response: { errorCode: 'DEPARTMENT_HAS_DEPENDENCIES' },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('restores a deleted departamento', async () => {
    const deleted = makeDepartamento({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    const restored = makeDepartamento();
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(null).mockResolvedValueOnce(restored);
    repo.restore!.mockResolvedValue({ affected: 1 });

    const result = await service.restore(deleted.orgId, deleted.id);

    expect(repo.restore).toHaveBeenCalledWith(deleted.id);
    expect(result).toBe(restored);
  });

  it('throws ConflictException when restoring an active departamento', async () => {
    repo.findOne!.mockResolvedValue(makeDepartamento());

    await expect(service.restore('org-1', 'dep-1')).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when restoring causes a name conflict', async () => {
    const deleted = makeDepartamento({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(makeDepartamento({ id: 'other' }));

    await expect(service.restore(deleted.orgId, deleted.id)).rejects.toThrow(ConflictException);
  });

  describe('findOneLocked()', () => {
    // Used by AreasService.create() / CargosService.create() (dept-level) to
    // take a shared lock on the departamento row inside their own
    // transaction, so their insert can't land in the gap between remove()'s
    // dependency count and its soft-delete. Tested here in isolation with a
    // fake manager rather than through remove()'s real transaction.
    const fakeManager = { getRepository: () => repo } as unknown as EntityManager;

    it('locks & returns the departamento row', async () => {
      const departamento = makeDepartamento();
      repo.findOne!.mockResolvedValue(departamento);

      await expect(
        service.findOneLocked(fakeManager, departamento.orgId, departamento.id),
      ).resolves.toBe(departamento);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: departamento.id, orgId: departamento.orgId },
        lock: { mode: 'pessimistic_read' },
      });
    });

    it('throws NotFoundException when the departamento is missing', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findOneLocked(fakeManager, 'org-1', 'dep-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
