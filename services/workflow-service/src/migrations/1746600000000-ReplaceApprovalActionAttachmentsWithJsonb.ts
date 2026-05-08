import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza las 4 columnas de adjunto individual en workflow_approval_actions
 * por una columna JSONB que permite múltiples adjuntos por acción.
 */
export class ReplaceApprovalActionAttachmentsWithJsonb1746600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Eliminar columnas individuales si existen (de la migración anterior)
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP COLUMN IF EXISTS "attachment_storage_key",
        DROP COLUMN IF EXISTS "attachment_original_name",
        DROP COLUMN IF EXISTS "attachment_mime_type",
        DROP COLUMN IF EXISTS "attachment_file_size_bytes"
    `);

    // Agregar columna JSONB para múltiples adjuntos
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP COLUMN IF EXISTS "attachments"
    `);

    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD COLUMN IF NOT EXISTS "attachment_storage_key"    VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_original_name"  VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_mime_type"      VARCHAR(100),
        ADD COLUMN IF NOT EXISTS "attachment_file_size_bytes" BIGINT
    `);
  }
}
