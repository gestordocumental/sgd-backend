import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supporting index for StructureLeasesService.sweepExpired() — its DELETE
 * filters purely on `expires_at` (`WHERE expires_at < clock_timestamp()`),
 * with no constraint on structure_type/structure_id. The composite index
 * from 1776600000000-AddStructureLeases (`structure_type, structure_id,
 * expires_at`) can't serve that query at all: Postgres can only use a
 * multi-column index efficiently when the query constrains its leading
 * column(s), and this DELETE constrains neither. Without a dedicated index,
 * the opportunistic sweep (reserve()'s SWEEP_PROBABILITY, ~2% of calls) does
 * a full sequential scan that gets more expensive as the table grows under
 * sustained typology/user creation traffic — exactly the growth the sweep
 * itself exists to bound, so it needs to stay cheap regardless of table size.
 *
 * A separate migration, not an edit to 1776600000000's `up()`: that
 * migration has already run in every environment that's deployed this
 * branch (confirmed via Railway's `migration:run:prod` log — "No migrations
 * are pending" the moment structure_leases first shipped), so TypeORM would
 * never re-apply an edited version of it there. New index, new migration.
 */
export class AddStructureLeasesExpiresAtIndex1776700000000 implements MigrationInterface {
  name = 'AddStructureLeasesExpiresAtIndex1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_structure_leases_expires_at" ON "structure_leases" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_structure_leases_expires_at"`);
  }
}
