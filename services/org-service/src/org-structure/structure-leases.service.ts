import { Injectable } from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
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

  /** Records a short-lived claim that `structureId` was ACTIVE just now. */
  async reserve(
    manager: EntityManager,
    orgId: string,
    structureType: StructureType,
    structureId: string,
    requestedBy?: string,
  ): Promise<void> {
    const lease = manager.getRepository(StructureLease).create({
      orgId,
      structureType,
      structureId,
      requestedBy: requestedBy ?? null,
      expiresAt: new Date(Date.now() + StructureLeasesService.LEASE_TTL_MS),
    });
    await manager.getRepository(StructureLease).save(lease);
  }

  /** Counts non-expired leases for a node — a positive count means a create/update may be in flight. */
  countActive(manager: EntityManager, structureType: StructureType, structureId: string): Promise<number> {
    return manager.getRepository(StructureLease).count({
      where: { structureType, structureId, expiresAt: MoreThan(new Date()) },
    });
  }
}
