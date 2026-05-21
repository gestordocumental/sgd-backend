import { Test, TestingModule } from '@nestjs/testing';
import { CargosController } from './cargos.controller';
import { CargosService } from './cargos.service';
import { Cargo } from './entities/cargo.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeCargo = (overrides: Partial<Cargo> = {}): Cargo => ({
  id: 'e7e89b73-1a33-477f-9504-f6dadbd28643',
  orgId: '69c25029-d301-4e74-bc4a-a7413e05829f',
  departamentoId: '8a75963e-d1fd-4ca6-82fd-ab77f2f4bcff',
  areaId: 'f30f632d-d926-4f47-ad53-9c07d0771f4f',
  name: 'Analista',
  description: 'Analiza procesos',
  area: {} as never,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Cargo);

describe('CargosController', () => {
  let controller: CargosController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CargosController],
      providers: [{ provide: CargosService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(CargosController);
  });

  it('creates and maps a cargo', async () => {
    const cargo = makeCargo();
    service.create.mockResolvedValue(cargo);

    const result = await controller.create('actor-1', cargo.orgId, cargo.departamentoId, cargo.areaId!, { name: cargo.name });

    expect(service.create).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.areaId!, {
      name: cargo.name,
    }, 'actor-1');
    expect(result).toMatchObject({ id: cargo.id, areaId: cargo.areaId, name: cargo.name });
  });

  it('maps findAll results', async () => {
    const cargos = [makeCargo()];
    service.findAll.mockResolvedValue(cargos);

    const result = await controller.findAll('org-1', 'dep-1', 'area-1');

    expect(service.findAll).toHaveBeenCalledWith('org-1', 'dep-1', 'area-1');
    expect(result[0]).toMatchObject({ id: cargos[0].id });
  });

  it('maps findOne result', async () => {
    const cargo = makeCargo();
    service.findOne.mockResolvedValue(cargo);

    const result = await controller.findOne(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id);

    expect(service.findOne).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id);
    expect(result).toMatchObject({ id: cargo.id });
  });

  it('updates and maps a cargo', async () => {
    const cargo = makeCargo({ name: 'Coordinador' });
    service.update.mockResolvedValue(cargo);

    const result = await controller.update('actor-1', cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id, {
      name: 'Coordinador',
    });

    expect(service.update).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id, {
      name: 'Coordinador',
    }, 'actor-1');
    expect(result).toMatchObject({ name: 'Coordinador' });
  });

  it('delegates remove to the service', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('actor-1', 'org-1', 'dep-1', 'area-1', 'cargo-1');

    expect(service.remove).toHaveBeenCalledWith('org-1', 'dep-1', 'area-1', 'cargo-1', 'actor-1');
  });

  it('restores and maps a cargo', async () => {
    const cargo = makeCargo();
    service.restore.mockResolvedValue(cargo);

    const result = await controller.restore('actor-1', cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id);

    expect(service.restore).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.areaId!, cargo.id, 'actor-1');
    expect(result).toMatchObject({ id: cargo.id });
  });
});
