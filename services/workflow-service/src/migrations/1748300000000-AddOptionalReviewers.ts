import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOptionalReviewers1748300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add allowed_optional_reviewer_ids to workflow_admin_cycles
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_cycles"
      ADD COLUMN IF NOT EXISTS "allowed_optional_reviewer_ids" uuid[] NOT NULL DEFAULT '{}'
    `);

    // Add is_optional flag to workflow_admin_steps
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_steps"
      ADD COLUMN IF NOT EXISTS "is_optional" boolean NOT NULL DEFAULT false
    `);

    // Add reference to the step that triggered insertion of an optional step
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_steps"
      ADD COLUMN IF NOT EXISTS "inserted_by_step_id" uuid NULL REFERENCES "workflow_admin_steps"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_steps" DROP COLUMN IF EXISTS "inserted_by_step_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_steps" DROP COLUMN IF EXISTS "is_optional"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflow_admin_cycles" DROP COLUMN IF EXISTS "allowed_optional_reviewer_ids"
    `);
  }
}
