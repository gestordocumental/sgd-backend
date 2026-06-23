import { Test, TestingModule } from '@nestjs/testing';
import { DeptCargosController } from './dept-cargos.controller';
import { CargosService } from './cargos.service';
import { Cargo } from './entities/cargo.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeCargo = (overrides: Partial<Cargo> = {}): Cargo => ({
  id: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890',
  orgId: 'a1b2c3d4-e5f6-7890-abcd-123456789012',
  departamentoId: 'c1d2e3f4-a5b6-7890-abcd-234567890123',
  areaId: null,
  name: 'Director',
  description: 'Director de departamento',
  area: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Cargo);

describe('DeptCargosController', () => {
  let controller: DeptCargosController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create:             jest.fn(),
      findByDepartamento: jest.fn(),
      findOneDept:        jest.fn(),
      updateDept:         jest.fn(),
      removeDept:         jest.fn(),
      restoreDept:        jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeptCargosController],
      providers:   [{ provide: CargosService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(DeptCargosController);
  });

  it('creates and maps a dept-level cargo', async () => {
    const cargo = makeCargo();
    service.create.mockResolvedValue(cargo);

    const result = await controller.create('actor-1', cargo.orgId, cargo.departamentoId, { name: cargo.name });

    expect(service.create).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, null, { name: cargo.name }, 'actor-1');
    expect(result).toMatchObject({ id: cargo.id, name: cargo.name });
  });

  it('maps findAll results', async () => {
    const cargos = [makeCargo()];
    service.findByDepartamento.mockResolvedValue(cargos);

    const result = await controller.findAll('org-1', 'dep-1');

    expect(service.findByDepartamento).toHaveBeenCalledWith('org-1', 'dep-1');
    expect(result[0]).toMatchObject({ id: cargos[0].id });
  });

  it('maps findOne result', async () => {
    const cargo = makeCargo();
    service.findOneDept.mockResolvedValue(cargo);

    const result = await controller.findOne(cargo.orgId, cargo.departamentoId, cargo.id);

    expect(service.findOneDept).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.id);
    expect(result).toMatchObject({ id: cargo.id });
  });

  it('updates and maps a dept-level cargo', async () => {
    const cargo = makeCargo({ name: 'Gerente' });
    service.updateDept.mockResolvedValue(cargo);

    const result = await controller.update('actor-1', cargo.orgId, cargo.departamentoId, cargo.id, { name: 'Gerente' });

    expect(service.updateDept).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.id, { name: 'Gerente' }, 'actor-1');
    expect(result).toMatchObject({ name: 'Gerente' });
  });

  it('delegates remove to the service', async () => {
    service.removeDept.mockResolvedValue(undefined);

    await controller.remove('actor-1', 'org-1', 'dep-1', 'cargo-1');

    expect(service.removeDept).toHaveBeenCalledWith('org-1', 'dep-1', 'cargo-1', 'actor-1');
  });

  it('restores and maps a dept-level cargo', async () => {
    const cargo = makeCargo();
    service.restoreDept.mockResolvedValue(cargo);

    const result = await controller.restore('actor-1', cargo.orgId, cargo.departamentoId, cargo.id);

    expect(service.restoreDept).toHaveBeenCalledWith(cargo.orgId, cargo.departamentoId, cargo.id, 'actor-1');
    expect(result).toMatchObject({ id: cargo.id });
  });
});
