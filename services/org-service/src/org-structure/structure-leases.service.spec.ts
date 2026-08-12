import { EntityManager } from 'typeorm';
import { StructureLeasesService } from './structure-leases.service';
import { StructureLease } from './entities/structure-lease.entity';

// Chainable stand-in for TypeORM's SelectQueryBuilder/InsertQueryBuilder/
// DeleteQueryBuilder — every builder method used by the service returns
// `this` except the terminal ones (execute/getCount).
function makeQueryBuilder() {
  const qb: Record<string, jest.Mock> = {
    insert: jest.fn(),
    into: jest.fn(),
    values: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    delete: jest.fn(),
    getCount: jest.fn().mockResolvedValue(0),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  for (const key of ['insert', 'into', 'values', 'where', 'andWhere', 'delete']) {
    qb[key].mockReturnValue(qb);
  }
  return qb;
}

describe('StructureLeasesService', () => {
  let service: StructureLeasesService;
  let repo: { createQueryBuilder: jest.Mock };
  let repoQb: ReturnType<typeof makeQueryBuilder>;
  let managerQb: ReturnType<typeof makeQueryBuilder>;
  let manager: EntityManager;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    repoQb = makeQueryBuilder();
    managerQb = makeQueryBuilder();
    repo = { createQueryBuilder: jest.fn().mockReturnValue(repoQb) };
    manager = {
      getRepository: () => repo,
      createQueryBuilder: jest.fn().mockReturnValue(managerQb),
    } as unknown as EntityManager;
    service = new StructureLeasesService();
  });

  afterEach(() => {
    randomSpy?.mockRestore();
  });

  describe('reserve()', () => {
    // Regression: expiresAt used to be computed with this process's own
    // Date.now(). With org-service running as multiple instances,
    // countActive() (in whichever instance handles a concurrent delete)
    // could then be comparing against a clock that's skewed ahead —
    // treating a still-in-flight lease as already expired and letting the
    // delete proceed exactly while the write it should block is in flight.
    // Anchoring to Postgres's own now() removes that skew.
    it('inserts via Postgres now() rather than this process\'s Date.now(), with a null requestedBy by default', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // above SWEEP_PROBABILITY — no sweep

      await service.reserve(manager, 'org-1', 'departamento', 'dept-1');

      expect(managerQb.insert).toHaveBeenCalled();
      expect(managerQb.into).toHaveBeenCalledWith(StructureLease);
      expect(managerQb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          structureType: 'departamento',
          structureId: 'dept-1',
          requestedBy: null,
        }),
      );
      const values = managerQb.values.mock.calls[0][0] as { expiresAt: () => string };
      expect(typeof values.expiresAt).toBe('function');
      expect(values.expiresAt()).toBe("now() + interval '30000 milliseconds'");
      expect(managerQb.execute).toHaveBeenCalled();
    });

    it('passes through a given requestedBy', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      await service.reserve(manager, 'org-1', 'cargo', 'cargo-1', 'document-service');

      expect(managerQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: 'document-service' }),
      );
    });

    // Regression: no cron/scheduler infra exists in this codebase — the
    // table only shrinks via this opportunistic sweep, so it must actually
    // fire (on the fraction of calls it's supposed to) or structure_leases
    // grows unboundedly under sustained traffic.
    it('sweeps expired leases (via Postgres now()) when the random roll lands under SWEEP_PROBABILITY', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.01); // 0.01 < 0.02

      await service.reserve(manager, 'org-1', 'area', 'area-1');

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('lease');
      expect(repoQb.delete).toHaveBeenCalled();
      expect(repoQb.where).toHaveBeenCalledWith('lease.expiresAt < now()');
      expect(repoQb.execute).toHaveBeenCalled();
    });

    it('does not sweep when the random roll lands above SWEEP_PROBABILITY', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      await service.reserve(manager, 'org-1', 'area', 'area-1');

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('countActive()', () => {
    it('counts leases scoped to the given structureType/structureId, comparing against Postgres now()', async () => {
      repoQb.getCount.mockResolvedValue(2);

      const result = await service.countActive(manager, 'cargo', 'cargo-1');

      expect(result).toBe(2);
      expect(repo.createQueryBuilder).toHaveBeenCalledWith('lease');
      expect(repoQb.where).toHaveBeenCalledWith('lease.structureType = :structureType', { structureType: 'cargo' });
      expect(repoQb.andWhere).toHaveBeenCalledWith('lease.structureId = :structureId', { structureId: 'cargo-1' });
      expect(repoQb.andWhere).toHaveBeenCalledWith('lease.expiresAt > now()');
    });

    it('returns 0 when there are no active leases', async () => {
      repoQb.getCount.mockResolvedValue(0);

      await expect(service.countActive(manager, 'departamento', 'dept-1')).resolves.toBe(0);
    });
  });
});
