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
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    repoQb = makeQueryBuilder();
    managerQb = makeQueryBuilder();
    repo = { createQueryBuilder: jest.fn().mockReturnValue(repoQb) };
    manager = {
      getRepository: () => repo,
      createQueryBuilder: jest.fn().mockReturnValue(managerQb),
      query: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager;
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new StructureLeasesService(logger as any);
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
    // Anchoring to Postgres's own clock removes that skew.
    //
    // Uses clock_timestamp(), not now(): now() is frozen at the
    // transaction's BEGIN, but this insert runs after resolveStructureById()
    // already waited on a FOR SHARE lock — using now() could insert a lease
    // whose TTL is already partly (or, past 30s of cumulative wait,
    // entirely) eaten by time that elapsed before the row even exists.
    // clock_timestamp() reflects the actual instant this statement runs.
    it('inserts via Postgres clock_timestamp() rather than this process\'s Date.now(), with a null requestedBy by default', async () => {
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
      expect(values.expiresAt()).toBe("clock_timestamp() + interval '30000 milliseconds'");
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
    // Regression: sweepExpired() used to run a plain query-builder DELETE
    // with no isolation from the caller's own transaction and no bound on
    // how many rows it could touch. Now it's raw SQL wrapped in a SAVEPOINT
    // (so a failure can be rolled back without poisoning reserve()'s
    // transaction) and capped at SWEEP_BATCH_SIZE rows per sweep.
    it('sweeps expired leases inside a SAVEPOINT (via Postgres clock_timestamp()), bounded to SWEEP_BATCH_SIZE, when the random roll lands under SWEEP_PROBABILITY', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.01); // 0.01 < 0.02

      await service.reserve(manager, 'org-1', 'area', 'area-1');

      const calls = (manager.query as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe('SAVEPOINT sweep_expired_leases');
      expect(calls[1][0]).toContain('DELETE FROM "structure_leases"');
      expect(calls[1][0]).toContain('expires_at" < clock_timestamp()');
      expect(calls[1][0]).toContain('LIMIT $1');
      expect(calls[1][1]).toEqual([500]);
      expect(calls[2][0]).toBe('RELEASE SAVEPOINT sweep_expired_leases');
    });

    it('does not sweep when the random roll lands above SWEEP_PROBABILITY', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      await service.reserve(manager, 'org-1', 'area', 'area-1');

      expect(manager.query).not.toHaveBeenCalled();
    });

    // Regression: if the sweep's DELETE hit a deadlock/lock-timeout, Postgres
    // marks the whole transaction aborted regardless of a JS try/catch — the
    // caller's real work (the lease insert reserve() exists to do) must
    // still go through and this best-effort cleanup must not surface as a
    // failure. ROLLBACK TO SAVEPOINT is what actually un-poisons the
    // transaction; a bare try/catch around the DELETE would not be enough.
    it('rolls back to the savepoint and logs a warning instead of throwing when the sweep DELETE fails — reserve() still succeeds', async () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.01);
      (manager.query as jest.Mock)
        .mockResolvedValueOnce(undefined) // SAVEPOINT
        .mockRejectedValueOnce(new Error('deadlock detected')) // DELETE
        .mockResolvedValueOnce(undefined) // ROLLBACK TO SAVEPOINT
        .mockResolvedValueOnce(undefined); // RELEASE SAVEPOINT (after rollback)

      await expect(service.reserve(manager, 'org-1', 'area', 'area-1')).resolves.toBeUndefined();

      const calls = (manager.query as jest.Mock).mock.calls;
      expect(calls[2][0]).toBe('ROLLBACK TO SAVEPOINT sweep_expired_leases');
      // Postgres keeps a savepoint defined after ROLLBACK TO — must be
      // released explicitly, or it lingers until the outer transaction ends.
      expect(calls[3][0]).toBe('RELEASE SAVEPOINT sweep_expired_leases');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Opportunistic structure_leases sweep failed'),
        'StructureLeasesService',
      );
      // The actual lease reservation — the one thing that must never be
      // sacrificed for a best-effort cleanup — still went through.
      expect(managerQb.execute).toHaveBeenCalled();
    });
  });

  describe('countActive()', () => {
    it('counts leases scoped to the given structureType/structureId, comparing against Postgres clock_timestamp()', async () => {
      repoQb.getCount.mockResolvedValue(2);

      const result = await service.countActive(manager, 'cargo', 'cargo-1');

      expect(result).toBe(2);
      expect(repo.createQueryBuilder).toHaveBeenCalledWith('lease');
      expect(repoQb.where).toHaveBeenCalledWith('lease.structureType = :structureType', { structureType: 'cargo' });
      expect(repoQb.andWhere).toHaveBeenCalledWith('lease.structureId = :structureId', { structureId: 'cargo-1' });
      expect(repoQb.andWhere).toHaveBeenCalledWith('lease.expiresAt > clock_timestamp()');
    });

    it('returns 0 when there are no active leases', async () => {
      repoQb.getCount.mockResolvedValue(0);

      await expect(service.countActive(manager, 'departamento', 'dept-1')).resolves.toBe(0);
    });
  });
});
