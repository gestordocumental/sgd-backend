import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
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

  /**
   * Records a short-lived claim that `structureId` was ACTIVE just now.
   * Occasionally piggybacks a best-effort purge of expired leases — see
   * SWEEP_PROBABILITY.
   *
   * expiresAt is computed by Postgres (`now() + interval ...`), not by this
   * process's own clock: org-service runs as multiple instances, and
   * countActive() below runs in whichever instance handles the delete
   * request — a different process than the one that reserved the lease. If
   * expiresAt were computed from this process's Date.now() and compared
   * against another process's new Date() in countActive(), clock skew
   * between instances could make a still-in-flight lease look expired
   * (deleting instance's clock ahead of the reserving one) — remove()
   * would then proceed exactly while the write it's supposed to be
   * blocking is still in flight, defeating the whole point of the lease.
   * Anchoring both sides to the DB's own clock removes that skew entirely.
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
        expiresAt: () => `now() + interval '${StructureLeasesService.LEASE_TTL_MS} milliseconds'`,
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
      .andWhere('lease.expiresAt > now()')
      .getCount();
  }

  private async sweepExpired(manager: EntityManager): Promise<void> {
    await manager
      .getRepository(StructureLease)
      .createQueryBuilder('lease')
      .delete()
      .where('lease.expiresAt < now()')
      .execute();
  }
}
