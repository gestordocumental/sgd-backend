import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AreasService } from './areas.service';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { DepartamentosService } from './departamentos.service';
import { DocumentClientService } from '../common/document-client/document-client.service';
import { UserClientService } from '../common/user-client/user-client.service';
import { StructureLeasesService } from './structure-leases.service';
import { ExternalReferencesGuard } from './external-references.guard';
import { KafkaProducerService } from '@sgd/common';

type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const makeArea = (overrides: Partial<Area> = {}): Area => ({
  id: '9722396c-f4b1-49e3-9cbc-d9f902e33081',
  orgId: '81f77cac-eb57-4d95-a2eb-554419ff7263',
  departamentoId: '4ad98982-803a-4d0d-a91d-b292bd7ad53d',
  name: 'Pagos',
  description: 'Gestion de pagos',
  departamento: {} as never,
  cargos: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Area);

describe('AreasService', () => {
  let service: AreasService;
  let repo: MockRepo<Area>;
  let cargoRepo: MockRepo<Cargo>;
  let departamentosService: { findOne: jest.Mock; findOneLocked: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let kafkaProducer: { emitSafe: jest.Mock };
  let documentClient: { countOrgStructureReferences: jest.Mock };
  let userClient: { countOrgStructureReferences: jest.Mock };
  let structureLeases: { countActive: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
    };
    // Defaults to "no dependent cargos" so every remove()/restore() test not
    // specifically about the dependency guard doesn't have to opt in.
    cargoRepo = { count: jest.fn().mockResolvedValue(0) };
    departamentosService = {
      findOne: jest.fn().mockResolvedValue({ id: 'dep-1' }),
      findOneLocked: jest.fn().mockResolvedValue({ id: 'dep-1' }),
    };
    // Defaults to "no external references" so every remove() test not
    // specifically about this guard doesn't have to opt in.
    documentClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    userClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    // Defaults to "no pending cross-service lease" so every remove() test
    // not specifically about this guard doesn't have to opt in.
    structureLeases = { countActive: jest.fn().mockResolvedValue(0) };
    // create()/remove() run inside a transaction now (race-condition fix);
    // this fakes .transaction() by handing the callback a manager whose
    // getRepository() resolves back to the same mocks above, so existing
    // assertions on repo/cargoRepo keep working unchanged. Wrapped in an
    // extra microtask (async/await) rather than resolving synchronously, so
    // ordering regressions (an audit log emitted from inside the callback,
    // before "commit") are actually observable by tests below.
    dataSource = {
      transaction: jest.fn(async (cb: (manager: EntityManager) => unknown) => {
        const result = await cb({
          getRepository: (entity: unknown) => {
            if (entity === Area) return repo;
            if (entity === Cargo) return cargoRepo;
            throw new Error('unexpected entity in mock transaction manager');
          },
        } as unknown as EntityManager);
        await Promise.resolve(); // simulates the commit happening after the callback returns
        return result;
      }),
    };
    kafkaProducer = { emitSafe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AreasService,
        { provide: getRepositoryToken(Area), useValue: repo },
        { provide: getRepositoryToken(Cargo), useValue: cargoRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: DepartamentosService, useValue: departamentosService },
        // Real ExternalReferencesGuard wired to the mocked clients below — keeps
        // existing assertions on the resulting ConflictException shape valid
        // without duplicating that shape here.
        { provide: ExternalReferencesGuard, useValue: new ExternalReferencesGuard(documentClient as unknown as DocumentClientService, userClient as unknown as UserClientService) },
        { provide: StructureLeasesService, useValue: structureLeases },
        { provide: KafkaProducerService, useValue: kafkaProducer },
      ],
    }).compile();

    service = module.get(AreasService);
  });

  it('creates an area after validating the parent departamento', async () => {
    const area = makeArea();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(area);
    repo.save!.mockResolvedValue(area);

    const result = await service.create(area.orgId, area.departamentoId, { name: area.name });

    expect(departamentosService.findOneLocked).toHaveBeenCalledWith(
      expect.anything(),
      area.orgId,
      area.departamentoId,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { departamentoId: area.departamentoId, name: area.name },
    });
    expect(result).toBe(area);
  });

  it('emits the AREA_CREATED audit log only after the transaction commits, not from inside it', async () => {
    // Regression: emitAuditLog used to be called from inside the
    // dataSource.transaction() callback — Kafka would receive the event even
    // if the commit failed afterward, since emitSafe doesn't participate in
    // the transaction and can't be rolled back with it.
    const area = makeArea();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(area);
    repo.save!.mockResolvedValue(area);

    const order: string[] = [];
    dataSource.transaction.mockImplementation(async (cb: (manager: unknown) => unknown) => {
      const result = await cb({
        getRepository: (entity: unknown) => (entity === Area ? repo : cargoRepo),
      });
      order.push('transaction-committed');
      return result;
    });
    kafkaProducer.emitSafe.mockImplementation(() => order.push('audit-log-emitted'));

    await service.create(area.orgId, area.departamentoId, { name: area.name }, 'actor-1');

    expect(order).toEqual(['transaction-committed', 'audit-log-emitted']);
  });

  it('throws ConflictException when creating a duplicated area', async () => {
    repo.findOne!.mockResolvedValue(makeArea());

    await expect(service.create('org-1', 'dep-1', { name: 'Pagos' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('returns areas ordered by name', async () => {
    const areas = [makeArea()];
    repo.find!.mockResolvedValue(areas);

    await expect(service.findAll('org-1', 'dep-1')).resolves.toEqual(areas);
    expect(repo.find).toHaveBeenCalledWith({
      where: { orgId: 'org-1', departamentoId: 'dep-1' },
      order: { name: 'ASC' },
      take: 500,
    });
  });

  it('returns one area by composite scope', async () => {
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);

    await expect(service.findOne(area.orgId, area.departamentoId, area.id)).resolves.toBe(area);
  });

  it('throws NotFoundException when area does not exist', async () => {
    repo.findOne!.mockResolvedValue(null);

    await expect(service.findOne('org-1', 'dep-1', 'area-1')).rejects.toThrow(NotFoundException);
  });

  it('updates an area', async () => {
    const area = makeArea();
    const saved = makeArea({ name: 'Cobranza' });
    repo.findOne!
      .mockResolvedValueOnce(area)
      .mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    const result = await service.update(area.orgId, area.departamentoId, area.id, {
      name: 'Cobranza',
    });

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cobranza' }));
    expect(result).toBe(saved);
  });

  it('throws ConflictException when updating to a duplicated area name', async () => {
    repo.findOne!
      .mockResolvedValueOnce(makeArea())
      .mockResolvedValueOnce(makeArea({ id: 'other' }));

    await expect(service.update('org-1', 'dep-1', 'area-1', { name: 'Cobranza' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('soft deletes an area with no cargos', async () => {
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);

    await service.remove(area.orgId, area.departamentoId, area.id);

    expect(cargoRepo.count).toHaveBeenCalledWith({ where: { areaId: area.id } });
    expect(repo.softRemove).toHaveBeenCalledWith(area);
  });

  it('throws ConflictException instead of deleting an area that still has cargos', async () => {
    // Regression: softRemove() issues an UPDATE, so the entity's
    // onDelete: 'RESTRICT' FK constraint (which only fires on a real SQL
    // DELETE) never protected against this — deletion used to silently
    // succeed and orphan the cargos.
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);
    cargoRepo.count!.mockResolvedValue(3);

    await expect(service.remove(area.orgId, area.departamentoId, area.id)).rejects.toMatchObject({
      response: { errorCode: 'AREA_HAS_DEPENDENCIES' },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('throws ConflictException instead of deleting an area a typology or user still references directly', async () => {
    // Regression: a typology/user can be scoped at the area level (no
    // cargo) — the intra-service cargo count above doesn't catch that.
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);
    documentClient.countOrgStructureReferences.mockResolvedValue(1);
    userClient.countOrgStructureReferences.mockResolvedValue(2);

    await expect(service.remove(area.orgId, area.departamentoId, area.id)).rejects.toMatchObject({
      response: {
        errorCode: 'AREA_HAS_EXTERNAL_REFERENCES',
        params: { typologiesCount: 1, usersCount: 2 },
      },
    });
    expect(documentClient.countOrgStructureReferences).toHaveBeenCalledWith(area.orgId, { areaId: area.id });
    expect(userClient.countOrgStructureReferences).toHaveBeenCalledWith(area.orgId, { areaId: area.id });
    expect(repo.softRemove).not.toHaveBeenCalled();
    // The external check runs before the transaction/lock is even opened —
    // holding a row lock across the ~5s outbound HTTP timeout ceiling would
    // be worse than the race it exists to close.
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('throws ConflictException instead of deleting an area with an active cross-service lease (MGESTDOC TOCTOU fix)', async () => {
    // Regression: a typology/user creation that already resolved this area
    // (BulkStructureService.resolveStructureById()) but hasn't finished
    // persisting yet must block the delete, even though the external
    // reference count above is still 0 (the reference doesn't exist yet).
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);
    structureLeases.countActive.mockResolvedValue(1);

    await expect(service.remove(area.orgId, area.departamentoId, area.id)).rejects.toMatchObject({
      response: { errorCode: 'AREA_HAS_PENDING_OPERATION', params: { id: area.id } },
    });
    expect(structureLeases.countActive).toHaveBeenCalledWith(expect.anything(), 'area', area.id);
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('fails closed: propagates the error instead of allowing the delete when the reference check itself fails', async () => {
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);
    documentClient.countOrgStructureReferences.mockRejectedValue(
      new ServiceUnavailableException('document-service is temporarily unavailable'),
    );

    await expect(service.remove(area.orgId, area.departamentoId, area.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repo.softRemove).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('restores a deleted area', async () => {
    const deleted = makeArea({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    const restored = makeArea();
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(null).mockResolvedValueOnce(restored);
    repo.restore!.mockResolvedValue({ affected: 1 });

    const result = await service.restore(deleted.orgId, deleted.departamentoId, deleted.id);

    expect(repo.restore).toHaveBeenCalledWith(deleted.id);
    expect(result).toBe(restored);
  });

  it('throws ConflictException when restoring an active area', async () => {
    repo.findOne!.mockResolvedValue(makeArea());

    await expect(service.restore('org-1', 'dep-1', 'area-1')).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when restoring causes a duplicate area name', async () => {
    const deleted = makeArea({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(makeArea({ id: 'other' }));

    await expect(service.restore(deleted.orgId, deleted.departamentoId, deleted.id)).rejects.toThrow(
      ConflictException,
    );
  });

  describe('findOneLocked()', () => {
    // Used by CargosService.create() to take a shared lock on the area row
    // inside its own transaction, so a cargo insert can't land in the gap
    // between remove()'s dependency count and its soft-delete. Tested here
    // in isolation with a fake manager rather than through remove()'s real
    // transaction.
    const fakeManager = { getRepository: () => repo } as unknown as EntityManager;

    it('locks & returns the area row', async () => {
      const area = makeArea();
      repo.findOne!.mockResolvedValue(area);

      await expect(
        service.findOneLocked(fakeManager, area.orgId, area.departamentoId, area.id),
      ).resolves.toBe(area);
      expect(departamentosService.findOne).toHaveBeenCalledWith(area.orgId, area.departamentoId);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: area.id, orgId: area.orgId, departamentoId: area.departamentoId },
        lock: { mode: 'pessimistic_read' },
      });
    });

    it('throws NotFoundException when the area is missing', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(
        service.findOneLocked(fakeManager, 'org-1', 'dep-1', 'area-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
