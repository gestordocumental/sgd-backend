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
    // Restore DOCUMENTS permissions
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
  }
}
