import { Test, TestingModule } from '@nestjs/testing';
import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';
import { Area } from './entities/area.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeArea = (overrides: Partial<Area> = {}): Area => ({
  id: '5b3be4de-e064-4a5a-8daf-e486eb512020',
  orgId: 'a6d575ee-c47d-4cf0-ad05-5c4f8b8655a5',
  departamentoId: '1c5de7da-8f9a-48b5-a246-a3dbeeb44b22',
  name: 'Pagos',
  description: 'Gestion de pagos',
  departamento: {} as never,
  cargos: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Area);

describe('AreasController', () => {
  let controller: AreasController;
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
      controllers: [AreasController],
      providers: [{ provide: AreasService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(AreasController);
  });

  it('creates and maps an area', async () => {
    const area = makeArea();
    service.create.mockResolvedValue(area);

    const result = await controller.create('actor-1', area.orgId, area.departamentoId, { name: area.name });

    expect(service.create).toHaveBeenCalledWith(area.orgId, area.departamentoId, { name: area.name }, 'actor-1');
    expect(result).toMatchObject({ id: area.id, departamentoId: area.departamentoId, name: area.name });
  });

  it('maps findAll results', async () => {
    const areas = [makeArea()];
    service.findAll.mockResolvedValue(areas);

    const result = await controller.findAll('org-1', 'dep-1');

    expect(service.findAll).toHaveBeenCalledWith('org-1', 'dep-1');
    expect(result[0]).toMatchObject({ id: areas[0].id });
  });

  it('maps findOne result', async () => {
    const area = makeArea();
    service.findOne.mockResolvedValue(area);

    const result = await controller.findOne(area.orgId, area.departamentoId, area.id);

    expect(service.findOne).toHaveBeenCalledWith(area.orgId, area.departamentoId, area.id);
    expect(result).toMatchObject({ id: area.id });
  });

  it('updates and maps an area', async () => {
    const area = makeArea({ name: 'Cobranza' });
    service.update.mockResolvedValue(area);

    const result = await controller.update('actor-1', area.orgId, area.departamentoId, area.id, { name: 'Cobranza' });

    expect(service.update).toHaveBeenCalledWith(area.orgId, area.departamentoId, area.id, { name: 'Cobranza' }, 'actor-1');
    expect(result).toMatchObject({ name: 'Cobranza' });
  });

  it('delegates remove to the service', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('actor-1', 'org-1', 'dep-1', 'area-1');

    expect(service.remove).toHaveBeenCalledWith('org-1', 'dep-1', 'area-1', 'actor-1');
  });

  it('restores and maps an area', async () => {
    const area = makeArea();
    service.restore.mockResolvedValue(area);

    const result = await controller.restore('actor-1', area.orgId, area.departamentoId, area.id);

    expect(service.restore).toHaveBeenCalledWith(area.orgId, area.departamentoId, area.id, 'actor-1');
    expect(result).toMatchObject({ id: area.id });
  });
});
