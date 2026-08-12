import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CargosService } from './cargos.service';
import { Cargo } from './entities/cargo.entity';
import { AreasService } from './areas.service';
import { DepartamentosService } from './departamentos.service';
import { DocumentClientService } from '../common/document-client/document-client.service';
import { UserClientService } from '../common/user-client/user-client.service';
import { KafkaProducerService } from '@sgd/common';

type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const makeCargo = (overrides: Partial<Cargo> = {}): Cargo => ({
  id: '4af03963-8460-4468-ae11-085f5038ef89',
  orgId: '70f4dd8a-fa2a-4481-bb7d-f083e0afab4a',
  departamentoId: 'd3d10a6c-79c6-4272-a922-2ea2f9de5e94',
  areaId: '666d9fb7-789e-4e6e-8f7c-bd1ebf95c996',
  name: 'Analista',
  description: 'Analiza procesos',
  area: {} as never,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Cargo);

describe('CargosService', () => {
  let service: CargosService;
  let repo: MockRepo<Cargo>;
  let areasService: { findOne: jest.Mock; findOneLocked: jest.Mock };
  let departamentosService: { findOne: jest.Mock; findOneLocked: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let kafkaProducer: { emitSafe: jest.Mock };
  let documentClient: { countOrgStructureReferences: jest.Mock };
  let userClient: { countOrgStructureReferences: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
    };
    areasService = {
      findOne: jest.fn().mockResolvedValue({ id: 'area-1' }),
      findOneLocked: jest.fn().mockResolvedValue({ id: 'area-1' }),
    };
    departamentosService = {
      findOne: jest.fn(),
      findOneLocked: jest.fn().mockResolvedValue({ id: 'dep-1' }),
    };
    // Defaults to "no external references" so every remove()/removeDept()
    // test not specifically about this guard doesn't have to opt in.
    documentClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    userClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    // create() runs inside a transaction now (race-condition fix); this
    // fakes .transaction() by handing the callback a manager whose
    // getRepository() resolves back to the same repo mock above, so
    // existing assertions on repo keep working unchanged. Wrapped in an
    // extra microtask (async/await) rather than resolving synchronously, so
    // ordering regressions (an audit log emitted from inside the callback,
    // before "commit") are actually observable by tests below.
    dataSource = {
      transaction: jest.fn(async (cb: (manager: EntityManager) => unknown) => {
        const result = await cb({ getRepository: () => repo } as unknown as EntityManager);
        await Promise.resolve(); // simulates the commit happening after the callback returns
        return result;
      }),
    };
    kafkaProducer = { emitSafe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CargosService,
        { provide: getRepositoryToken(Cargo), useValue: repo },
        { provide: DataSource, useValue: dataSource },
        { provide: AreasService, useValue: areasService },
        { provide: DepartamentosService, useValue: departamentosService },
        { provide: DocumentClientService, useValue: documentClient },
        { provide: UserClientService, useValue: userClient },
        { provide: KafkaProducerService, useValue: kafkaProducer },
      ],
    }).compile();

    service = module.get(CargosService);
  });

  it('creates a cargo after validating the parent area', async () => {
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(cargo);
    repo.save!.mockResolvedValue(cargo);

    const result = await service.create(cargo.orgId, cargo.departamentoId, cargo.areaId, {
      name: cargo.name,
    });

    expect(areasService.findOneLocked).toHaveBeenCalledWith(
      expect.anything(),
      cargo.orgId,
      cargo.departamentoId,
      cargo.areaId,
    );
    expect(repo.findOne).toHaveBeenCalledWith({ where: { areaId: cargo.areaId, name: cargo.name } });
    expect(result).toBe(cargo);
  });

  it('creates a department-level cargo (areaId null) after validating the parent departamento', async () => {
    // Department-level cargos have no area to lock, so they take the shared
    // lock on the departamento row instead — see
    // DepartamentosService.findOneLocked() and the areaId-present case above.
    const cargo = makeCargo({ areaId: null });
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(cargo);
    repo.save!.mockResolvedValue(cargo);

    const result = await service.create(cargo.orgId, cargo.departamentoId, null, {
      name: cargo.name,
    });

    expect(departamentosService.findOneLocked).toHaveBeenCalledWith(
      expect.anything(),
      cargo.orgId,
      cargo.departamentoId,
    );
    expect(areasService.findOneLocked).not.toHaveBeenCalled();
    expect(result).toBe(cargo);
  });

  it('emits the CARGO_CREATED audit log only after the transaction commits, not from inside it', async () => {
    // Regression: emitAuditLog used to be called from inside the
    // dataSource.transaction() callback — Kafka would receive the event even
    // if the commit failed afterward, since emitSafe doesn't participate in
    // the transaction and can't be rolled back with it.
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(cargo);
    repo.save!.mockResolvedValue(cargo);

    const order: string[] = [];
    dataSource.transaction.mockImplementation(async (cb: (manager: unknown) => unknown) => {
      const result = await cb({ getRepository: () => repo });
      order.push('transaction-committed');
      return result;
    });
    kafkaProducer.emitSafe.mockImplementation(() => order.push('audit-log-emitted'));

    await service.create(cargo.orgId, cargo.departamentoId, cargo.areaId, { name: cargo.name }, 'actor-1');

    expect(order).toEqual(['transaction-committed', 'audit-log-emitted']);
  });

  it('throws ConflictException when creating a duplicated cargo', async () => {
    repo.findOne!.mockResolvedValue(makeCargo());

    await expect(service.create('org-1', 'dep-1', 'area-1', { name: 'Analista' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('returns cargos ordered by name', async () => {
    const cargos = [makeCargo()];
    repo.find!.mockResolvedValue(cargos);

    await expect(service.findAll('org-1', 'dep-1', 'area-1')).resolves.toEqual(cargos);
    expect(repo.find).toHaveBeenCalledWith({
      where: { orgId: 'org-1', departamentoId: 'dep-1', areaId: 'area-1' },
      order: { name: 'ASC' },
      take: 500,
    });
  });

  it('returns cargos by organization', async () => {
    const cargos = [makeCargo()];
    repo.find!.mockResolvedValue(cargos);

    await expect(service.findAllByOrg('org-1')).resolves.toEqual(cargos);
    expect(repo.find).toHaveBeenCalledWith({
      where: { orgId: 'org-1' },
      order: { name: 'ASC' },
      take: 500,
    });
  });

  it('returns one cargo by composite scope', async () => {
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);

    await expect(service.findOne(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id)).resolves.toBe(
      cargo,
    );
  });

  it('throws NotFoundException when cargo does not exist', async () => {
    repo.findOne!.mockResolvedValue(null);

    await expect(service.findOne('org-1', 'dep-1', 'area-1', 'cargo-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updates a cargo', async () => {
    const cargo = makeCargo();
    const saved = makeCargo({ name: 'Coordinador' });
    repo.findOne!
      .mockResolvedValueOnce(cargo)
      .mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    const result = await service.update(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id, {
      name: 'Coordinador',
    });

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Coordinador' }));
    expect(result).toBe(saved);
  });

  it('throws ConflictException when updating to a duplicated cargo name', async () => {
    repo.findOne!
      .mockResolvedValueOnce(makeCargo())
      .mockResolvedValueOnce(makeCargo({ id: 'other' }));

    await expect(
      service.update('org-1', 'dep-1', 'area-1', 'cargo-1', { name: 'Coordinador' }),
    ).rejects.toThrow(ConflictException);
  });

  it('soft deletes a cargo', async () => {
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);

    await service.remove(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id);

    expect(documentClient.countOrgStructureReferences).toHaveBeenCalledWith(cargo.orgId, { cargoId: cargo.id });
    expect(userClient.countOrgStructureReferences).toHaveBeenCalledWith({ cargoId: cargo.id });
    expect(repo.softRemove).toHaveBeenCalledWith(cargo);
  });

  it('throws ConflictException instead of deleting a cargo a typology still references', async () => {
    // Regression: this is the reported bug — deleting a cargo used to
    // silently succeed even when a typology or user still pointed at it,
    // leaving that record with a dangling cargoId.
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);
    documentClient.countOrgStructureReferences.mockResolvedValue(2);

    await expect(
      service.remove(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id),
    ).rejects.toMatchObject({
      response: { errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES', params: { typologiesCount: 2, usersCount: 0 } },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('throws ConflictException instead of deleting a cargo a user still references', async () => {
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);
    userClient.countOrgStructureReferences.mockResolvedValue(1);

    await expect(
      service.remove(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id),
    ).rejects.toMatchObject({
      response: { errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES', params: { typologiesCount: 0, usersCount: 1 } },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('combines both counts in one error when both a typology and a user reference the cargo', async () => {
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);
    documentClient.countOrgStructureReferences.mockResolvedValue(3);
    userClient.countOrgStructureReferences.mockResolvedValue(5);

    await expect(
      service.remove(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id),
    ).rejects.toMatchObject({
      response: { errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES', params: { typologiesCount: 3, usersCount: 5 } },
    });
  });

  it('fails closed: propagates the error instead of allowing the delete when the reference check itself fails', async () => {
    // If document-service/user-service is unreachable, the delete must be
    // rejected — never silently allowed through.
    const cargo = makeCargo();
    repo.findOne!.mockResolvedValue(cargo);
    documentClient.countOrgStructureReferences.mockRejectedValue(
      new ServiceUnavailableException('document-service is temporarily unavailable'),
    );

    await expect(
      service.remove(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('soft deletes a department-level cargo with no external references', async () => {
    const cargo = makeCargo({ areaId: null });
    repo.findOne!.mockResolvedValue(cargo);

    await service.removeDept(cargo.orgId, cargo.departamentoId, cargo.id);

    expect(documentClient.countOrgStructureReferences).toHaveBeenCalledWith(cargo.orgId, { cargoId: cargo.id });
    expect(userClient.countOrgStructureReferences).toHaveBeenCalledWith({ cargoId: cargo.id });
    expect(repo.softRemove).toHaveBeenCalledWith(cargo);
  });

  it('throws ConflictException instead of deleting a department-level cargo still referenced', async () => {
    const cargo = makeCargo({ areaId: null });
    repo.findOne!.mockResolvedValue(cargo);
    documentClient.countOrgStructureReferences.mockResolvedValue(1);

    await expect(service.removeDept(cargo.orgId, cargo.departamentoId, cargo.id)).rejects.toMatchObject({
      response: { errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES' },
    });
    expect(repo.softRemove).not.toHaveBeenCalled();
  });

  it('restores a deleted cargo', async () => {
    const deleted = makeCargo({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    const restored = makeCargo();
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(null).mockResolvedValueOnce(restored);
    repo.restore!.mockResolvedValue({ affected: 1 });

    const result = await service.restore(deleted.orgId, deleted.departamentoId, deleted.areaId!, deleted.id);

    expect(repo.restore).toHaveBeenCalledWith(deleted.id);
    expect(result).toBe(restored);
  });

  it('throws ConflictException when restoring an active cargo', async () => {
    repo.findOne!.mockResolvedValue(makeCargo());

    await expect(service.restore('org-1', 'dep-1', 'area-1', 'cargo-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws ConflictException when restoring causes a duplicate cargo name', async () => {
    const deleted = makeCargo({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(makeCargo({ id: 'other' }));

    await expect(service.restore(deleted.orgId, deleted.departamentoId, deleted.areaId!, deleted.id)).rejects.toThrow(
      ConflictException,
    );
  });
});
