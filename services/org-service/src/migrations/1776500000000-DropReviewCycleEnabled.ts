import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The review-cycle feature flag moved from org-wide to per-typology (see
 * document-service's Typology.reviewCycleEnabled). This column is no longer
 * read anywhere — workflow-service now checks document-service instead.
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
