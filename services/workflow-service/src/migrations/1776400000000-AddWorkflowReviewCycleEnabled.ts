import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalized snapshot of the typology's reviewCycleEnabled flag at the
 * moment this workflow was created — mirrors typology_code/typology_name/
 * typology_version, which exist for the same reason (avoid querying
 * document-service on every read). Used only for frontend display (show/hide
 * the "Iniciar ciclo de revisión" action); the authoritative check is a live
 * call to document-service in approve()/createCycle(). Defaults to false —
 * the review cycle is now opt-in per typology instead of org-wide.
 */
export class AddWorkflowReviewCycleEnabled1776400000000 implements MigrationInterface {
  name = 'AddWorkflowReviewCycleEnabled1776400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflows"
        ADD COLUMN "review_cycle_enabled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflows" DROP COLUMN "review_cycle_enabled"
    `);
  }
}
