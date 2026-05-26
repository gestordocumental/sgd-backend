import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { Org, OrgStatus } from './entities/org.entity';
import { OrgGuard } from '../common/guards/org.guard';

const buildJwt = (payload: Record<string, unknown>) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
};

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

describe('OrgsController', () => {
  let controller: OrgsController;
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
      controllers: [OrgsController],
      providers: [{ provide: OrgsService, useValue: service }],
    })
      .overrideGuard(OrgGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(OrgsController);
  });

  it('creates an organization using the user id extracted from the JWT', async () => {
    const org = makeOrg();
    service.create.mockResolvedValue(org);

    const result = await controller.create('user-1', { name: 'Acme' });

    expect(service.create).toHaveBeenCalledWith({ name: 'Acme' }, 'user-1');
    expect(result).toMatchObject({ id: org.id, name: org.name });
  });

  it('throws when user id cannot be extracted from the token', async () => {
    await expect(controller.create(undefined, { name: 'Acme' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('maps findAll results to response DTOs', async () => {
    const orgs = [makeOrg()];
    service.findAll.mockResolvedValue({ data: orgs, total: 1 });

    const result = await controller.findAll(1, 20);

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: orgs[0].id, name: orgs[0].name });
  });

  it('maps findOne result to response DTO', async () => {
    const org = makeOrg();
    service.findOne.mockResolvedValue(org);

    const result = await controller.findOne(org.id);

    expect(service.findOne).toHaveBeenCalledWith(org.id);
    expect(result).toMatchObject({ id: org.id, name: org.name });
  });

  it('delegates updates to the service and maps the response', async () => {
    const org = makeOrg({ name: 'Beta' });
    service.update.mockResolvedValue(org);

    const result = await controller.update('actor-1', org.id, { name: 'Beta' });

    expect(service.update).toHaveBeenCalledWith(org.id, { name: 'Beta' }, 'actor-1');
    expect(result).toMatchObject({ id: org.id, name: 'Beta' });
  });

  it('throws UnauthorizedException when actorId is missing on update', async () => {
    await expect(controller.update(undefined, 'org-1', { name: 'X' })).rejects.toThrow(UnauthorizedException);
  });

  it('delegates delete to the service', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('actor-1', 'org-1');

    expect(service.remove).toHaveBeenCalledWith('org-1', 'actor-1');
  });

  it('throws UnauthorizedException when actorId is missing on remove', async () => {
    await expect(controller.remove(undefined, 'org-1')).rejects.toThrow(UnauthorizedException);
  });

  it('delegates restore to the service and maps the response', async () => {
    const org = makeOrg();
    service.restore.mockResolvedValue(org);

    const result = await controller.restore('actor-1', org.id);

    expect(service.restore).toHaveBeenCalledWith(org.id, 'actor-1');
    expect(result).toMatchObject({ id: org.id, name: org.name });
  });

  it('throws UnauthorizedException when actorId is missing on restore', async () => {
    await expect(controller.restore(undefined, 'org-1')).rejects.toThrow(UnauthorizedException);
  });
});
