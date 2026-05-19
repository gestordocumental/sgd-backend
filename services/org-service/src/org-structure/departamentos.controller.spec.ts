import { Test, TestingModule } from '@nestjs/testing';
import { DepartamentosController } from './departamentos.controller';
import { DepartamentosService } from './departamentos.service';
import { Departamento } from './entities/departamento.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeDepartamento = (overrides: Partial<Departamento> = {}): Departamento => ({
  id: '8d5a2a2c-a436-4f84-9617-c366f727263a',
  orgId: '1645a78b-ff77-4dce-84b6-9cb3f2cb2b10',
  name: 'Finanzas',
  description: 'Gestion financiera',
  areas: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Departamento);

describe('DepartamentosController', () => {
  let controller: DepartamentosController;
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
      controllers: [DepartamentosController],
      providers: [{ provide: DepartamentosService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(DepartamentosController);
  });

  it('creates and maps a departamento', async () => {
    const departamento = makeDepartamento();
    service.create.mockResolvedValue(departamento);

    const result = await controller.create('actor-1', departamento.orgId, { name: departamento.name });

    expect(service.create).toHaveBeenCalledWith(departamento.orgId, { name: departamento.name }, 'actor-1');
    expect(result).toMatchObject({ id: departamento.id, orgId: departamento.orgId, name: departamento.name });
  });

  it('maps findAll results', async () => {
    const departamentos = [makeDepartamento()];
    service.findAll.mockResolvedValue(departamentos);

    const result = await controller.findAll('org-1');

    expect(service.findAll).toHaveBeenCalledWith('org-1');
    expect(result[0]).toMatchObject({ id: departamentos[0].id });
  });

  it('maps findOne result', async () => {
    const departamento = makeDepartamento();
    service.findOne.mockResolvedValue(departamento);

    const result = await controller.findOne(departamento.orgId, departamento.id);

    expect(service.findOne).toHaveBeenCalledWith(departamento.orgId, departamento.id);
    expect(result).toMatchObject({ id: departamento.id });
  });

  it('updates and maps a departamento', async () => {
    const departamento = makeDepartamento({ name: 'Tesoreria' });
    service.update.mockResolvedValue(departamento);

    const result = await controller.update('actor-1', departamento.orgId, departamento.id, { name: 'Tesoreria' });

    expect(service.update).toHaveBeenCalledWith(departamento.orgId, departamento.id, { name: 'Tesoreria' }, 'actor-1');
    expect(result).toMatchObject({ name: 'Tesoreria' });
  });

  it('delegates remove to the service', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('actor-1', 'org-1', 'dep-1');

    expect(service.remove).toHaveBeenCalledWith('org-1', 'dep-1', 'actor-1');
  });

  it('restores and maps a departamento', async () => {
    const departamento = makeDepartamento();
    service.restore.mockResolvedValue(departamento);

    const result = await controller.restore('actor-1', departamento.orgId, departamento.id);

    expect(service.restore).toHaveBeenCalledWith(departamento.orgId, departamento.id, 'actor-1');
    expect(result).toMatchObject({ id: departamento.id });
  });
});
