import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppLogger } from '@sgd/common';
import { StructureLease, StructureType } from './entities/structure-lease.entity';

/**
 * See StructureLease entity for the full design reasoning. Both methods take
 * the caller's `EntityManager` explicitly (same convention as
 * DepartamentosService/AreasService's `findOneLocked()`) so the insert/count
 * participates in the caller's own transaction — and therefore in the same
 * row lock — instead of running as an unrelated, unlocked query.
 */
@Injectable()
export class StructureLeasesService {
  // 6x the full HTTP round-trip timeout budget (ORG_SERVICE_TIMEOUT_MS /
  // DOCUMENT_SERVICE_TIMEOUT_MS both default to 5000ms in the calling
  // services) — between obtaining a lease and the caller's actual DB write
  // there's no further network I/O, just a local insert, so this is
  // generous headroom rather than a tightly-tuned bound.
  private static readonly LEASE_TTL_MS = 30_000;

  // No cron/scheduler infra exists anywhere in this codebase (no
  // @nestjs/schedule, no external job runner) — rather than add one just
  // for this, reserve() opportunistically sweeps already-expired rows on a
  // small fraction of calls. countActive() already filters by expiresAt, so
  // correctness never depended on this; it only bounds how large the table
  // (and its index) grows under sustained typology/user creation traffic.
  // 1-in-50 keeps the extra DELETE off the hot path almost always while
  // still running often in aggregate at any real traffic volume.
  private static readonly SWEEP_PROBABILITY = 0.02;

  // Caps how many expired rows a single sweep deletes. Sweeping is
  // opportunistic and repeats on ~2% of calls, so an unbounded backlog just
  // takes a few more sweeps to fully drain — no need for one call to finish
  // the whole job, and every call staying cheap matters more (see
  // sweepExpired()'s docstring for why an unbounded DELETE is a real risk).
  private static readonly SWEEP_BATCH_SIZE = 500;

  constructor(private readonly logger: AppLogger) {}

  /**
   * Records a short-lived claim that `structureId` was ACTIVE just now.
   * Occasionally piggybacks a best-effort purge of expired leases — see
   * SWEEP_PROBABILITY.
   *
   * expiresAt is computed by Postgres, not by this process's own clock:
   * org-service runs as multiple instances, and countActive() below runs in
   * whichever instance handles the delete request — a different process
   * than the one that reserved the lease. If expiresAt were computed from
   * this process's Date.now() and compared against another process's new
   * Date() in countActive(), clock skew between instances could make a
   * still-in-flight lease look expired (deleting instance's clock ahead of
   * the reserving one) — remove() would then proceed exactly while the
   * write it's supposed to be blocking is still in flight, defeating the
   * whole point of the lease. Anchoring both sides to the DB's own clock
   * removes that skew entirely.
   *
   * Uses `clock_timestamp()`, not `now()`: inside a transaction, Postgres's
   * `now()` is frozen at the transaction's BEGIN, not the moment the
   * statement actually runs. This method's own transaction (opened by
   * resolveStructureById()) takes `FOR SHARE` locks before reaching this
   * insert, and remove()'s transaction takes `FOR UPDATE` before reaching
   * countActive()/sweepExpired() — either can genuinely wait on lock
   * contention. With `now()`, a long-enough wait would insert a lease whose
   * TTL is already partly (or, past 30s of cumulative wait, entirely)
   * eaten by time that already elapsed before the row even exists, and
   * would compare countActive()'s check against a stale "now" from before
   * the wait — letting an already-expired lease still read as active, or a
   * freshly-inserted one read as expired. `clock_timestamp()` reflects the
   * actual wall-clock instant each statement runs, immune to both.
   */
  async reserve(
    manager: EntityManager,
    orgId: string,
    structureType: StructureType,
    structureId: string,
    requestedBy?: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(StructureLease)
      .values({
        orgId,
        structureType,
        structureId,
        requestedBy: requestedBy ?? null,
        expiresAt: () => `clock_timestamp() + interval '${StructureLeasesService.LEASE_TTL_MS} milliseconds'`,
      })
      .execute();

    if (Math.random() < StructureLeasesService.SWEEP_PROBABILITY) {
      await this.sweepExpired(manager);
    }
  }

  /** Counts non-expired leases for a node — a positive count means a create/update may be in flight. */
  countActive(manager: EntityManager, structureType: StructureType, structureId: string): Promise<number> {
    return manager
      .getRepository(StructureLease)
      .createQueryBuilder('lease')
      .where('lease.structureType = :structureType', { structureType })
      .andWhere('lease.structureId = :structureId', { structureId })
      .andWhere('lease.expiresAt > clock_timestamp()')
      .getCount();
  }

  /**
   * Best-effort — must never poison reserve()'s caller transaction (this
   * runs inside resolveStructureById()'s transaction, whose actual job — the
   * lease insert above — must still commit even if this cleanup fails). A
   * plain try/catch around the DELETE would NOT be enough on its own: once
   * any statement inside a Postgres transaction errors (deadlock, lock
   * timeout, statement_timeout), the whole transaction is marked aborted at
   * the server level, and every later statement — including the eventual
   * COMMIT — fails with "current transaction is aborted" regardless of what
   * application code does with the JS exception. A SAVEPOINT is the actual
   * mechanism Postgres provides for this: ROLLBACK TO SAVEPOINT un-poisons
   * the transaction, letting the caller's insert/commit proceed normally.
   *
   * Also bounded (SWEEP_BATCH_SIZE) rather than deleting every expired row
   * in one statement — an unbounded DELETE takes row locks on every matched
   * row for the rest of this transaction, which under a large backlog could
   * hold those locks far longer than necessary and contend with concurrent
   * countActive()/reserve() calls touching the same table.
   */
  private async sweepExpired(manager: EntityManager): Promise<void> {
    await manager.query('SAVEPOINT sweep_expired_leases');
    try {
      await manager.query(
        `DELETE FROM "structure_leases" WHERE "id" IN (
           SELECT "id" FROM "structure_leases" WHERE "expires_at" < clock_timestamp() LIMIT $1
         )`,
        [StructureLeasesService.SWEEP_BATCH_SIZE],
      );
      await manager.query('RELEASE SAVEPOINT sweep_expired_leases');
    } catch (err) {
      // ROLLBACK TO SAVEPOINT undoes the DELETE but does NOT release the
      // savepoint itself — Postgres keeps it defined until this RELEASE (or
      // the outer transaction ends). Without it, a transaction that calls
      // reserve() more than once (resolveStructureById() does, up to once
      // per departamento/area/cargo resolved) and hits a failing sweep more
      // than once would just keep nesting same-named savepoints instead of
      // cleanly reusing this one.
      await manager.query('ROLLBACK TO SAVEPOINT sweep_expired_leases');
      await manager.query('RELEASE SAVEPOINT sweep_expired_leases');
      this.logger.warn(
        `Opportunistic structure_leases sweep failed (harmless — best-effort cleanup, caller's ` +
          `transaction is unaffected): ${err instanceof Error ? err.message : String(err)}`,
        'StructureLeasesService',
      );
    }
  }
}
