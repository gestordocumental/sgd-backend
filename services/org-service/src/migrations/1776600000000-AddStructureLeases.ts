import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs the cross-service TOCTOU fix between org-service's structure
 * deletion (DepartamentosService/AreasService/CargosService.remove()) and
 * document-service/user-service's structure validation before persisting a
 * new/changed reference (BulkStructureService.resolveStructureById()).
 *
 * A lease is a short-TTL claim inserted while holding a `pessimistic_read`
 * lock on the departamento/area/cargo row (the same `SELECT ... FOR SHARE`
 * pattern DepartamentosService.findOneLocked() already uses for the
 * org-service-internal create-vs-delete race) — remove() checks for active
 * leases inside its own `pessimistic_write`-locked transaction before
 * soft-deleting, so Postgres's row-lock serialization closes the gap. See
 * StructureLease entity for the full reasoning. No release endpoint: a
 * lease is simply ignored once `expires_at` passes.
 */
export class AddStructureLeases1776600000000 implements MigrationInterface {
  name = 'AddStructureLeases1776600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "structure_leases" (
        "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
        "org_id"         UUID        NOT NULL,
        "structure_type" VARCHAR(20) NOT NULL,
        "structure_id"   UUID        NOT NULL,
        "requested_by"   VARCHAR(50),
        "expires_at"     TIMESTAMPTZ NOT NULL,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_structure_leases" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_structure_leases_org_id" ON "structure_leases" ("org_id")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_structure_leases_lookup"
        ON "structure_leases" ("structure_type", "structure_id", "expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "structure_leases"`);
  }
}
