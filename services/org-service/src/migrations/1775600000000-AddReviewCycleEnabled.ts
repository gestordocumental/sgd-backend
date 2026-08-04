import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feature flag letting an org disable the admin review cycle step of the
 * workflow flow entirely. Defaults to true so existing orgs keep today's
 * behavior unchanged after this migration runs.
 */
export class AddReviewCycleEnabled1775600000000 implements MigrationInterface {
  name = 'AddReviewCycleEnabled1775600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orgs"
        ADD COLUMN "review_cycle_enabled" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orgs" DROP COLUMN "review_cycle_enabled"
    `);
  }
}
