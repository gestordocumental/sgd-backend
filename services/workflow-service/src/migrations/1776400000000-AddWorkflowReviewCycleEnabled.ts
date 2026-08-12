import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalized snapshot of the typology's reviewCycleEnabled flag, fixed at
 * the moment this workflow was created and refreshed once more at the final
 * approval step (see WorkflowApprovalService.approve()) — mirrors
 * typology_code/typology_name/typology_version, which exist for the same
 * reason (avoid querying document-service on every read). This is the
 * authoritative, sole source of truth for whether a given workflow goes
 * through the review cycle: it is never re-checked live against
 * document-service after approval, so later changes to the typology's flag
 * only affect workflows created afterwards, not this one (MGESTDOC-58).
 * Defaults to false — the review cycle is opt-in per typology instead of
 * org-wide.
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
