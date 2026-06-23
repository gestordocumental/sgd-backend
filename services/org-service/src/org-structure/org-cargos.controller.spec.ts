import { Test, TestingModule } from '@nestjs/testing';
import { OrgCargosController } from './org-cargos.controller';
import { CargosService } from './cargos.service';
import { Cargo } from './entities/cargo.entity';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';

const makeCargo = (overrides: Partial<Cargo> = {}): Cargo => ({
  id: '78926745-3cbe-48d2-aa12-c7806a44ed47',
  orgId: '00a8c3c1-c5d2-4c67-83d9-710fe0712e44',
  departamentoId: '6d357605-f567-4c5d-a5c5-37c7e93a91b5',
  areaId: 'acfa3bc6-f90a-45db-aa2d-b8143f9f7823',
  name: 'Analista',
  description: 'Analiza procesos',
  area: {} as never,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
} as Cargo);

describe('OrgCargosController', () => {
  let controller: OrgCargosController;
  let service: { findAllByOrg: jest.Mock };

  beforeEach(async () => {
    service = { findAllByOrg: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgCargosController],
      providers: [{ provide: CargosService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OrgPermissionsGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(OrgCargosController);
  });

  it('maps organization cargos to response DTOs', async () => {
    const cargos = [makeCargo()];
    service.findAllByOrg.mockResolvedValue(cargos);

    const result = await controller.findAll('org-1');

    expect(service.findAllByOrg).toHaveBeenCalledWith('org-1');
    expect(result[0]).toMatchObject({ id: cargos[0].id, orgId: cargos[0].orgId });
  });
});
