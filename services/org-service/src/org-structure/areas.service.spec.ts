import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AreasService } from './areas.service';
import { Area } from './entities/area.entity';
import { DepartamentosService } from './departamentos.service';

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
  let departamentosService: { findOne: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
    };
    departamentosService = { findOne: jest.fn().mockResolvedValue({ id: 'dep-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AreasService,
        { provide: getRepositoryToken(Area), useValue: repo },
        { provide: DepartamentosService, useValue: departamentosService },
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

    expect(departamentosService.findOne).toHaveBeenCalledWith(area.orgId, area.departamentoId);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { departamentoId: area.departamentoId, name: area.name },
    });
    expect(result).toBe(area);
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

  it('soft deletes an area', async () => {
    const area = makeArea();
    repo.findOne!.mockResolvedValue(area);

    await service.remove(area.orgId, area.departamentoId, area.id);

    expect(repo.softRemove).toHaveBeenCalledWith(area);
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
});
