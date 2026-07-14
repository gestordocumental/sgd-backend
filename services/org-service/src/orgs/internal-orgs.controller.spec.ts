import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InternalGuard } from '@sgd/common';
import { InternalOrgsController } from './internal-orgs.controller';
import { OrgsService } from './orgs.service';
import { Org, OrgStatus } from './entities/org.entity';

const makeOrg = (overrides: Partial<Org> = {}): Org => ({
  id: '78a71a1c-e4e8-4d7c-8cf6-8d319d46177f',
  name: 'Acme',
  nit: '900123456',
  address: 'Main St',
  phone: '5551234',
  status: OrgStatus.ACTIVE,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

describe('InternalOrgsController', () => {
  let controller: InternalOrgsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalOrgsController],
      providers: [{ provide: OrgsService, useValue: service }],
    })
      .overrideGuard(InternalGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(InternalOrgsController);
  });

  describe('getStatus()', () => {
    it('returns the org id and status', async () => {
      service.findOne.mockResolvedValue(makeOrg({ status: OrgStatus.INACTIVE }));

      const result = await controller.getStatus('78a71a1c-e4e8-4d7c-8cf6-8d319d46177f');

      expect(service.findOne).toHaveBeenCalledWith('78a71a1c-e4e8-4d7c-8cf6-8d319d46177f');
      expect(result).toEqual({ id: '78a71a1c-e4e8-4d7c-8cf6-8d319d46177f', status: 'inactive' });
    });

    it('propagates NotFoundException for an unknown or deleted org', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('Organization x not found'));

      await expect(controller.getStatus('x')).rejects.toThrow(NotFoundException);
    });
  });
});
