import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega columnas opcionales a workflow_approval_actions para almacenar
 * el adjunto que el aprobador puede subir junto con su aprobación.
 * El archivo ya fue subido al storage via document-service /workflow-files.
 */
export class AddApprovalActionAttachment1746500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD COLUMN IF NOT EXISTS "attachment_storage_key"    VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_original_name"  VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_mime_type"      VARCHAR(100),
        ADD COLUMN IF NOT EXISTS "attachment_file_size_bytes" BIGINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP COLUMN IF EXISTS "attachment_storage_key",
        DROP COLUMN IF EXISTS "attachment_original_name",
        DROP COLUMN IF EXISTS "attachment_mime_type",
        DROP COLUMN IF EXISTS "attachment_file_size_bytes"
    `);
  }
}
