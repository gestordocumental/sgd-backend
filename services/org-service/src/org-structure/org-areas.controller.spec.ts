import { Test, TestingModule } from '@nestjs/testing';
import { OrgAreasController } from './org-areas.controller';
import { AreasService } from './areas.service';
import { Area } from './entities/area.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeArea = (overrides: Partial<Area> = {}): Area =>
  ({
    id:              'a1b2c3d4-0000-0000-0000-000000000001',
    orgId:           'b2c3d4e5-0000-0000-0000-000000000001',
    departamentoId:  'c3d4e5f6-0000-0000-0000-000000000001',
    name:            'Sistemas',
    description:     null,
    departamento:    {} as never,
    cargos:          [],
    createdAt:       new Date('2026-01-01T00:00:00.000Z'),
    updatedAt:       new Date('2026-01-02T00:00:00.000Z'),
    deletedAt:       null,
    ...overrides,
  } as Area);

describe('OrgAreasController', () => {
  let controller: OrgAreasController;
  let service: { findAllByOrg: jest.Mock };

  beforeEach(async () => {
    service = { findAllByOrg: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgAreasController],
      providers:   [{ provide: AreasService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(OrgAreasController);
  });

  afterEach(() => jest.clearAllMocks());

  it('maps organization areas to response DTOs', async () => {
    const areas = [makeArea()];
    service.findAllByOrg.mockResolvedValue(areas);

    const result = await controller.findAll('org-1');

    expect(service.findAllByOrg).toHaveBeenCalledWith('org-1');
    expect(result[0]).toMatchObject({ id: areas[0].id, orgId: areas[0].orgId });
  });

  it('returns an empty array when the org has no areas', async () => {
    service.findAllByOrg.mockResolvedValue([]);

    const result = await controller.findAll('org-empty');

    expect(result).toEqual([]);
  });
});
