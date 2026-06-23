import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixApprovalActionsCascade1747100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP CONSTRAINT IF EXISTS "FK_approval_actions_step_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD CONSTRAINT "FK_approval_actions_step_id"
        FOREIGN KEY ("step_id") REFERENCES "workflow_approval_steps"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP CONSTRAINT IF EXISTS "FK_approval_actions_step_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD CONSTRAINT "FK_approval_actions_step_id"
        FOREIGN KEY ("step_id") REFERENCES "workflow_approval_steps"("id")
    `);
  }
}
