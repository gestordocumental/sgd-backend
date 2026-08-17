import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-does what 1776400000000-CleanupUnusedPermissions.ts already did once —
 * that migration deleted the DOCUMENTS:* permission rows, but PermissionsSeeder
 * (permissions.seeder.ts, runs unconditionally on every boot via
 * OnApplicationBootstrap) kept re-inserting them on every subsequent restart,
 * since its PERMISSIONS_CATALOG still listed them. The seeder's catalog no
 * longer does (see that file), so this time the deletion actually sticks.
 *
 * document-service still has no RequirePermission guard on any endpoint for
 * these — this module was assignable in the roles editor but never checked
 * anywhere, by design decision (not planned for the foreseeable future).
 */
export class RemoveDocumentsPermissionsForGood1776900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Back up existing role assignments so down() can restore them exactly.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS migration_177690_role_permissions_backup (
        role_id uuid NOT NULL,
        permission_action text NOT NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO migration_177690_role_permissions_backup (role_id, permission_action)
      SELECT rp.role_id, p.action::text
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.module = 'DOCUMENTS'
    `);

    // 1. Unlink from roles first (FK constraint)
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (SELECT id FROM permissions WHERE module = 'DOCUMENTS')
    `);

    // 2. Delete the permission rows
    await queryRunner.query(`DELETE FROM permissions WHERE module = 'DOCUMENTS'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES
        (gen_random_uuid(), 'DOCUMENTS', 'READ',     'View documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'WRITE',    'Create and edit documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'DELETE',   'Delete documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'UPLOAD',   'Upload documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'DOWNLOAD', 'Download documents')
      ON CONFLICT (module, action) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT b.role_id, p.id
      FROM migration_177690_role_permissions_backup b
      JOIN permissions p
        ON p.module = 'DOCUMENTS'
       AND p.action::text = b.permission_action
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS migration_177690_role_permissions_backup`);
  }
}
