import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes permissions that have no active backend guard:
 *
 * DOCUMENTS:* (6 rows) — document-service only applies JwtGuard/OrgMember,
 *   no RequirePermission decorator on any endpoint. Permissions will be
 *   re-introduced with proper guards when the document module is built.
 *
 * ORGS:MANAGE (1 row) — never checked by any backend guard or frontend hook.
 */
export class CleanupUnusedPermissions1776400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Back up existing role assignments so down() can restore them exactly.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS migration_177640_role_permissions_backup (
        role_id uuid NOT NULL,
        permission_module text NOT NULL,
        permission_action text NOT NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO migration_177640_role_permissions_backup (role_id, permission_module, permission_action)
      SELECT rp.role_id, p.module::text, p.action::text
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.module = 'DOCUMENTS'
         OR (p.module = 'ORGS' AND p.action = 'MANAGE')
    `);

    // 1. Unlink from roles first (FK constraint)
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (
        SELECT id FROM permissions
        WHERE module = 'DOCUMENTS'
           OR (module = 'ORGS' AND action = 'MANAGE')
      )
    `);

    // 2. Delete the permission rows
    await queryRunner.query(`
      DELETE FROM permissions
      WHERE module = 'DOCUMENTS'
         OR (module = 'ORGS' AND action = 'MANAGE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore DOCUMENTS and ORGS:MANAGE permission rows
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES
        (gen_random_uuid(), 'DOCUMENTS', 'READ',     'View documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'WRITE',    'Create and edit documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'DELETE',   'Delete documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'APPROVE',  'Approve documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'UPLOAD',   'Upload files'),
        (gen_random_uuid(), 'DOCUMENTS', 'DOWNLOAD', 'Download files'),
        (gen_random_uuid(), 'ORGS',      'MANAGE',   'Full organization management')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // Restore the original role assignments from the backup
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT b.role_id, p.id
      FROM migration_177640_role_permissions_backup b
      JOIN permissions p
        ON p.module::text = b.permission_module
       AND p.action::text = b.permission_action
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS migration_177640_role_permissions_backup`);
  }
}
