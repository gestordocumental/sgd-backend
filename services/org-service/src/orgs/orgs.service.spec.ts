import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { OrgsService } from './orgs.service';
import { Org, OrgStatus } from './entities/org.entity';
import { KafkaProducerService } from '@sgd/common';

type MockRepo<T extends object> = Partial<Record<keyof Repository<T>, jest.Mock>>;

/** Returns a chainable QueryBuilder mock whose getManyAndCount resolves to [rows, total]. */
function makeQbMock(rows: Org[], total: number) {
  const qb: Record<string, jest.Mock> = {};
  const chain = () => qb as unknown as ReturnType<Repository<Org>['createQueryBuilder']>;
  ['withDeleted', 'orderBy', 'where', 'andWhere', 'skip', 'take'].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(chain());
  });
  qb['getManyAndCount'] = jest.fn().mockResolvedValue([rows, total]);
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
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softRemove: jest.fn(),
      restore: jest.fn(),
      createQueryBuilder: jest.fn(),
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
          useValue: { emitSafe: jest.fn() },
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

  it('returns paginated organizations with total count', async () => {
    const orgs = [makeOrg(), makeOrg({ id: 'a66cf75e-49d0-4c12-b3e3-af941da7f8f1', name: 'Beta' })];
    const qb = makeQbMock(orgs, 2);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result).toEqual({ data: orgs, total: 2 });
    expect(repo.createQueryBuilder).toHaveBeenCalledWith('o');
    expect(qb['withDeleted']).toHaveBeenCalled();
    expect(qb['getManyAndCount']).toHaveBeenCalled();
  });

  it('applies search filter via ILIKE when search param is provided', async () => {
    const orgs = [makeOrg()];
    const qb = makeQbMock(orgs, 1);
    repo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.findAll({ search: 'acme' });

    expect(qb['where']).toHaveBeenCalledWith(
      '(o.name ILIKE :q OR o.nit ILIKE :q)',
      { q: '%acme%' },
    );
  });

  it('filters deleted organizations when status is "deleted"', async () => {
    const qb = makeQbMock([], 0);
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
});
