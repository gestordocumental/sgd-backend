import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The review-cycle feature flag moved from org-wide to per-typology (see
 * document-service's Typology.reviewCycleEnabled). This column is no longer
 * read anywhere — workflow-service now checks document-service instead.
 *
 * Safe to drop with no data transfer here: this column was added by
 * 1775600000000-AddReviewCycleEnabled with DEFAULT true and — audited across
 * org-service — was never mapped on the Org entity nor read/written by any
 * controller/service/DTO, so every row has only ever held that default. There
 * is no per-org value to lose. The corresponding backfill of existing
 * typologies (to the same `true`, preserving today's always-on behavior) is
 * document-service's job — see its
 * src/scripts/backfill-review-cycle-enabled.ts — and is independent of this
 * migration's timing since it doesn't read this column.
 */
export class DropReviewCycleEnabled1776500000000 implements MigrationInterface {
  name = 'DropReviewCycleEnabled1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orgs" DROP COLUMN "review_cycle_enabled"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orgs"
        ADD COLUMN "review_cycle_enabled" boolean NOT NULL DEFAULT true
    `);
  }
}
