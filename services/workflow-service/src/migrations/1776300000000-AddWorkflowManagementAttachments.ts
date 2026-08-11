import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports the final-user "Gestionar" action: repeatable comments/attachments
 * on a workflow while it's AVAILABLE_FOR_FINAL_USERS, without starting a
 * formal admin cycle. Attachments added this way are tagged MANAGEMENT and
 * optionally linked back to the WorkflowNote they accompanied.
 */
export class AddWorkflowManagementAttachments1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."attachment_type_enum" ADD VALUE IF NOT EXISTS 'MANAGEMENT'
    `);

    await queryRunner.query(`
      ALTER TABLE "workflow_attachments"
      ADD COLUMN IF NOT EXISTS "note_id" uuid NULL REFERENCES "workflow_notes"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_attachments" DROP COLUMN IF EXISTS "note_id"
    `);
    // PostgreSQL does not support removing enum values directly.
    // A full migration would require recreating the type.
  }
}
