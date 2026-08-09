import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { OrgsService } from './orgs.service';
import { Org, OrgStatus } from './entities/org.entity';
import { KafkaProducerService } from '@sgd/common';
import { UserClientService } from '../common/user-client/user-client.service';

type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

/**
 * update() fires notifyOrgDeactivated fire-and-forget (not awaited), so its
 * internal chain (getActiveUserIds → emitSafe) may still be pending right
 * after service.update() resolves. Flushing a macrotask lets any queued
 * microtasks (however many links deep) settle before assertions run.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Returns a chainable QueryBuilder mock whose getMany resolves to rows. */
function makeQbMock(rows: Org[]) {
  const qb: Record<string, jest.Mock> = {};
  const chain = () => qb as unknown as ReturnType<Repository<Org>['createQueryBuilder']>;
  ['withDeleted', 'orderBy', 'addOrderBy', 'where', 'andWhere', 'take'].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(chain());
  });
  qb['getMany'] = jest.fn().mockResolvedValue(rows);
  return qb;
}

const makeOrg = (overrides: Partial<Org> = {}): Org => ({
  id: '8f9c1d7e-5f6e-4c52-ae54-8eb2be32a111',
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

describe('OrgsService', () => {
  let service: OrgsService;
  let repo: MockRepo<Org>;
  let kafkaProducer: { emitSafe: jest.Mock };
  let userClient: { revokeOrgAccess: jest.Mock; getActiveUserIds: jest.Mock };
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findBy: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    kafkaProducer = { emitSafe: jest.fn() };
    userClient = {
      revokeOrgAccess: jest.fn().mockResolvedValue(undefined),
      getActiveUserIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgsService,
        { provide: getRepositoryToken(Org), useValue: repo },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) =>
              ({ USER_SERVICE_URL: 'http://localhost:3001', INTERNAL_TOKEN_ORG_USER: 'test-token' }[key] ??
                (() => { throw new Error(`Missing config key: ${key}`); })()),
            ),
          },
        },
        {
          provide: KafkaProducerService,
          useValue: kafkaProducer,
        },
        {
          provide: UserClientService,
          useValue: userClient,
        },
      ],
    }).compile();

    service = module.get(OrgsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates an organization when the name is available', async () => {
    const dto = { name: 'Acme', nit: '900123456', address: 'Main St', phone: '5551234' };
    const created = makeOrg();
    repo.findOne!.mockResolvedValue(null);
    repo.create!.mockReturnValue(created);
    repo.save!.mockResolvedValue(created);

    const result = await service.create(dto, 'user-1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { name: 'Acme' } });
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Acme',
      nit: '900123456',
      address: 'Main St',
      phone: '5551234',
      status: OrgStatus.ACTIVE,
      createdBy: 'user-1',
    });
    expect(result).toBe(created);
  });

  it('throws ConflictException when creating a duplicated organization name', async () => {
    repo.findOne!.mockResolvedValue(makeOrg());

    await expect(service.create({ name: 'Acme' }, 'user-1')).rejects.toThrow(ConflictException);
  });

  it('returns paginated organizations with cursor pagination', async () => {
    const orgs = [makeOrg(), makeOrg({ id: 'a66cf75e-49d0-4c12-b3e3-af941da7f8f1', name: 'Beta' })];
    const qb = makeQbMock(orgs);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    const result = await service.findAll({ limit: 20 });

    expect(result).toMatchObject({ data: orgs, hasMore: false, nextCursor: null });
    expect(repo.createQueryBuilder).toHaveBeenCalledWith('o');
    expect(qb['withDeleted']).toHaveBeenCalled();
    expect(qb['getMany']).toHaveBeenCalled();
  });

  it('throws BadRequestException when cursor is malformed (garbled base64)', async () => {
    await expect(service.findAll({ cursor: 'not!!valid~~base64url' })).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when cursor decodes to valid JSON but contains non-UUID id', async () => {
    const bad = Buffer.from(
      JSON.stringify({ at: new Date().toISOString(), id: 'not-a-uuid' }),
    ).toString('base64url');

    await expect(service.findAll({ cursor: bad })).rejects.toThrow(BadRequestException);
  });

  it('applies search filter via ILIKE when search param is provided', async () => {
    const orgs = [makeOrg()];
    const qb = makeQbMock(orgs);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.findAll({ search: 'acme' });

    expect(qb['where']).toHaveBeenCalledWith(
      '(o.name ILIKE :q OR o.nit ILIKE :q)',
      { q: '%acme%' },
    );
  });

  it('filters deleted organizations when status is "deleted"', async () => {
    const qb = makeQbMock([]);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.findAll({ status: 'deleted' });

    expect(qb['andWhere']).toHaveBeenCalledWith('o.deletedAt IS NOT NULL');
  });

  it('returns one organization by id', async () => {
    const org = makeOrg();
    repo.findOne!.mockResolvedValue(org);

    await expect(service.findOne(org.id)).resolves.toBe(org);
  });

  it('throws NotFoundException when organization does not exist', async () => {
    repo.findOne!.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('updates an organization and keeps unchanged fields intact', async () => {
    const org = makeOrg();
    const saved = makeOrg({ name: 'New Name', phone: '999' });
    repo.findOne!
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    const result = await service.update(org.id, { name: 'New Name', phone: '999' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: org.id, name: 'New Name', phone: '999', address: 'Main St' }),
    );
    expect(result).toBe(saved);
  });

  it('throws ConflictException when updating to an existing name', async () => {
    const org = makeOrg();
    repo.findOne!
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(makeOrg({ id: 'other-org' }));

    await expect(service.update(org.id, { name: 'Taken' })).rejects.toThrow(ConflictException);
  });

  it('soft deletes an organization', async () => {
    const org = makeOrg();
    repo.findOne!.mockResolvedValue(org);

    await service.remove(org.id);

    expect(repo.softRemove).toHaveBeenCalledWith(org);
  });

  it('restores a soft deleted organization', async () => {
    const deleted = makeOrg({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
    const restored = makeOrg();
    repo.findOne!.mockResolvedValueOnce(deleted).mockResolvedValueOnce(restored);
    repo.restore!.mockResolvedValue({ affected: 1 });

    const result = await service.restore(deleted.id);

    expect(repo.restore).toHaveBeenCalledWith(deleted.id);
    expect(result).toBe(restored);
  });

  it('throws ConflictException when restoring an active organization', async () => {
    repo.findOne!.mockResolvedValue(makeOrg({ deletedAt: null }));

    await expect(service.restore('org-1')).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when restoring a missing organization', async () => {
    repo.findOne!.mockResolvedValue(null);

    await expect(service.restore('missing')).rejects.toThrow(NotFoundException);
  });

  it('filters active organizations when status is "active"', async () => {
    const qb = makeQbMock([makeOrg()]);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.findAll({ status: 'active' });

    expect(qb['andWhere']).toHaveBeenCalledWith('o.deletedAt IS NULL');
    expect(qb['andWhere']).toHaveBeenCalledWith('o.status = :s', { s: OrgStatus.ACTIVE });
  });

  it('filters inactive organizations when status is "inactive"', async () => {
    const qb = makeQbMock([]);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.findAll({ status: 'inactive' });

    expect(qb['andWhere']).toHaveBeenCalledWith('o.deletedAt IS NULL');
    expect(qb['andWhere']).toHaveBeenCalledWith('o.status != :s', { s: OrgStatus.ACTIVE });
  });

  it('emits audit log on update when actorId is provided', async () => {
    const org = makeOrg();
    const saved = makeOrg({ name: 'New Name' });
    repo.findOne!
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    await service.update(org.id, { name: 'New Name' }, 'actor-1');

    expect(kafkaProducer.emitSafe).toHaveBeenCalled();
  });

  // ── deactivation — proactive session revocation ─────────────────────────

  it('notifies affected users via Kafka when an org transitions from active to inactive', async () => {
    const org = makeOrg({ status: OrgStatus.ACTIVE });
    const saved = makeOrg({ status: OrgStatus.INACTIVE });
    repo.findOne!.mockResolvedValueOnce(org).mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);
    userClient.getActiveUserIds.mockResolvedValue(['user-1', 'user-2']);

    await service.update(org.id, { status: OrgStatus.INACTIVE });
    await flushMicrotasks(); // let the fire-and-forget notification chain settle

    expect(userClient.getActiveUserIds).toHaveBeenCalledWith(org.id);
    expect(kafkaProducer.emitSafe).toHaveBeenCalledWith('user.org-deactivated', {
      userId: 'user-1',
      orgId: org.id,
    });
    expect(kafkaProducer.emitSafe).toHaveBeenCalledWith('user.org-deactivated', {
      userId: 'user-2',
      orgId: org.id,
    });
  });

  it('does not notify when status is updated but the org was already inactive', async () => {
    const org = makeOrg({ status: OrgStatus.INACTIVE });
    const saved = makeOrg({ status: OrgStatus.INACTIVE });
    repo.findOne!.mockResolvedValueOnce(org).mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    await service.update(org.id, { status: OrgStatus.INACTIVE });

    expect(userClient.getActiveUserIds).not.toHaveBeenCalled();
  });

  it('does not notify when a non-status field is updated', async () => {
    const org = makeOrg({ status: OrgStatus.ACTIVE });
    const saved = makeOrg({ status: OrgStatus.ACTIVE, phone: '999' });
    repo.findOne!.mockResolvedValueOnce(org).mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);

    await service.update(org.id, { phone: '999' });

    expect(userClient.getActiveUserIds).not.toHaveBeenCalled();
  });

  it('does not fail the status update when notifying affected users fails', async () => {
    const org = makeOrg({ status: OrgStatus.ACTIVE });
    const saved = makeOrg({ status: OrgStatus.INACTIVE });
    repo.findOne!.mockResolvedValueOnce(org).mockResolvedValueOnce(null);
    repo.save!.mockResolvedValue(saved);
    userClient.getActiveUserIds.mockRejectedValueOnce(new Error('user-service unreachable'));

    await expect(service.update(org.id, { status: OrgStatus.INACTIVE })).resolves.toBe(saved);
  });

  it('compensates by restoring org when revokeOrgAccess fails during remove', async () => {
    const org = makeOrg();
    repo.findOne!.mockResolvedValue(org);
    repo.softRemove!.mockResolvedValue(undefined);
    repo.restore!.mockResolvedValue({ affected: 1 });
    userClient.revokeOrgAccess.mockRejectedValueOnce(new Error('Service unavailable'));

    await expect(service.remove(org.id)).rejects.toThrow('Service unavailable');

    expect(repo.softRemove).toHaveBeenCalledWith(org);
    expect(repo.restore).toHaveBeenCalledWith(org.id);
  });

  it('returns empty array from findByIds when ids list is empty', async () => {
    const result = await service.findByIds([]);

    expect(result).toEqual([]);
    expect(repo.findBy).not.toHaveBeenCalled();
  });

  it('returns organizations by id list from findByIds', async () => {
    const orgs = [makeOrg()];
    repo.findBy!.mockResolvedValue(orgs);

    const result = await service.findByIds([orgs[0].id]);

    expect(result).toBe(orgs);
  });
});
