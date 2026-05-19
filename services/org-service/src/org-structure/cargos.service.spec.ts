import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CargosService } from './cargos.service';
import { Cargo } from './entities/cargo.entity';
import { AreasService } from './areas.service';
import { DepartamentosService } from './departamentos.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';

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
  let areasService: { findOne: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
    };
    areasService = { findOne: jest.fn().mockResolvedValue({ id: 'area-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CargosService,
        { provide: getRepositoryToken(Cargo), useValue: repo },
        { provide: AreasService, useValue: areasService },
        { provide: DepartamentosService, useValue: { findOne: jest.fn() } },
        { provide: KafkaProducerService, useValue: { emitSafe: jest.fn() } },
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

    expect(areasService.findOne).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.areaId);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { areaId: cargo.areaId, name: cargo.name } });
    expect(result).toBe(cargo);
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
    });
  });

  it('returns cargos by organization', async () => {
    const cargos = [makeCargo()];
    repo.find!.mockResolvedValue(cargos);

    await expect(service.findAllByOrg('org-1')).resolves.toEqual(cargos);
    expect(repo.find).toHaveBeenCalledWith({ where: { orgId: 'org-1' }, order: { name: 'ASC' } });
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

    expect(repo.softRemove).toHaveBeenCalledWith(cargo);
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
