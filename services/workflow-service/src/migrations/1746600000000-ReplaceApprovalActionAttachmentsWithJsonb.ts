import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza las 4 columnas de adjunto individual en workflow_approval_actions
 * por una columna JSONB que permite múltiples adjuntos por acción.
 */
export class ReplaceApprovalActionAttachmentsWithJsonb1746600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agregar columna JSONB primero para no perder datos
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'
    `);

    // Migrar datos existentes de columnas individuales al formato JSONB
    await queryRunner.query(`
      UPDATE "workflow_approval_actions"
      SET "attachments" = jsonb_build_array(jsonb_build_object(
        'storageKey',    "attachment_storage_key",
        'originalName',  "attachment_original_name",
        'mimeType',      "attachment_mime_type",
        'fileSizeBytes', "attachment_file_size_bytes"
      ))
      WHERE "attachment_storage_key" IS NOT NULL
    `);

    // Eliminar columnas individuales una vez migrados los datos
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP COLUMN IF EXISTS "attachment_storage_key",
        DROP COLUMN IF EXISTS "attachment_original_name",
        DROP COLUMN IF EXISTS "attachment_mime_type",
        DROP COLUMN IF EXISTS "attachment_file_size_bytes"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recrear columnas legacy antes de copiar datos desde JSONB
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        ADD COLUMN IF NOT EXISTS "attachment_storage_key"     VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_original_name"   VARCHAR(500),
        ADD COLUMN IF NOT EXISTS "attachment_mime_type"       VARCHAR(100),
        ADD COLUMN IF NOT EXISTS "attachment_file_size_bytes" BIGINT
    `);

    // Restaurar el primer adjunto del array JSONB a las columnas individuales.
    // Si hay más de un adjunto, solo el primero se preserva (la estructura legacy
    // no soportaba múltiples adjuntos por acción).
    await queryRunner.query(`
      UPDATE "workflow_approval_actions"
      SET
        "attachment_storage_key"     = "attachments"->0->>'storageKey',
        "attachment_original_name"   = "attachments"->0->>'originalName',
        "attachment_mime_type"       = "attachments"->0->>'mimeType',
        "attachment_file_size_bytes" = NULLIF("attachments"->0->>'fileSizeBytes', '')::BIGINT
      WHERE jsonb_array_length(COALESCE("attachments", '[]'::jsonb)) > 0
    `);

    // Eliminar la columna JSONB una vez restaurados los datos
    await queryRunner.query(`
      ALTER TABLE "workflow_approval_actions"
        DROP COLUMN IF EXISTS "attachments"
    `);
  }
}
