import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the permissions catalog and system roles.
 * Permissions are static system data — not created by users.
 * Uses ON CONFLICT DO NOTHING for idempotency.
 */
export class SeedPermissionsAndSystemRoles1773120000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Permissions catalog ───────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES
        (gen_random_uuid(), 'DOCUMENTS', 'READ',     'View documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'WRITE',    'Create and edit documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'DELETE',   'Delete documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'APPROVE',  'Approve documents'),
        (gen_random_uuid(), 'DOCUMENTS', 'UPLOAD',   'Upload files'),
        (gen_random_uuid(), 'DOCUMENTS', 'DOWNLOAD', 'Download files'),

        (gen_random_uuid(), 'WORKFLOWS', 'READ',     'View workflows'),
        (gen_random_uuid(), 'WORKFLOWS', 'WRITE',    'Create and edit workflows'),
        (gen_random_uuid(), 'WORKFLOWS', 'DELETE',   'Delete workflows'),
        (gen_random_uuid(), 'WORKFLOWS', 'APPROVE',  'Approve workflow steps'),

        (gen_random_uuid(), 'USERS',     'READ',     'View users'),
        (gen_random_uuid(), 'USERS',     'WRITE',    'Create and edit users'),
        (gen_random_uuid(), 'USERS',     'DELETE',   'Delete users'),
        (gen_random_uuid(), 'USERS',     'MANAGE',   'Full user management'),

        (gen_random_uuid(), 'ORGS',      'READ',     'View organization information'),
        (gen_random_uuid(), 'ORGS',      'WRITE',    'Edit organization information'),
        (gen_random_uuid(), 'ORGS',      'MANAGE',   'Full organization management'),

        (gen_random_uuid(), 'AUDIT',     'READ',     'View audit records'),

        (gen_random_uuid(), 'PLATFORM',  'MANAGE',   'Full platform access (super admin only)')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // ── System roles ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles (id, name, scope, description, is_system, org_id, created_at)
      VALUES
        (gen_random_uuid(), 'SUPER_ADMIN', 'SYSTEM', 'Full platform access',                  true, NULL, NOW()),
        (gen_random_uuid(), 'ADMIN',       'SYSTEM', 'Organization administrator',             true, NULL, NOW()),
        (gen_random_uuid(), 'MANAGER',     'SYSTEM', 'Manager with approval permissions',      true, NULL, NOW()),
        (gen_random_uuid(), 'EDITOR',      'SYSTEM', 'Can create and edit documents',          true, NULL, NOW()),
        (gen_random_uuid(), 'VIEWER',      'SYSTEM', 'Read-only',                              true, NULL, NOW())
      ON CONFLICT (name, org_id) DO NOTHING
    `);

    // ── Assign permissions to system roles ───────────────────────────────────
    // SUPER_ADMIN — all permissions
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'SUPER_ADMIN' AND r.org_id IS NULL
      ON CONFLICT DO NOTHING
    `);

    // ADMIN — all except PLATFORM:MANAGE
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'ADMIN' AND r.org_id IS NULL
        AND NOT (p.module = 'PLATFORM' AND p.action = 'MANAGE')
      ON CONFLICT DO NOTHING
    `);

    // MANAGER — documents (all), workflows (all), users (read), audit (read)
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'MANAGER' AND r.org_id IS NULL
        AND (
          p.module = 'DOCUMENTS'
          OR p.module = 'WORKFLOWS'
          OR (p.module = 'USERS'  AND p.action = 'READ')
          OR (p.module = 'AUDIT'  AND p.action = 'READ')
        )
      ON CONFLICT DO NOTHING
    `);

    // EDITOR — documents (read, write, upload, download), workflows (read)
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'EDITOR' AND r.org_id IS NULL
        AND (
          (p.module = 'DOCUMENTS' AND p.action IN ('READ', 'WRITE', 'UPLOAD', 'DOWNLOAD'))
          OR (p.module = 'WORKFLOWS' AND p.action = 'READ')
        )
      ON CONFLICT DO NOTHING
    `);

    // VIEWER — read-only on documents, workflows, audit
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'VIEWER' AND r.org_id IS NULL
        AND p.action = 'READ'
        AND p.module IN ('DOCUMENTS', 'WORKFLOWS', 'AUDIT')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id IN (
        SELECT id FROM roles WHERE is_system = true AND org_id IS NULL
      )
    `);
    await queryRunner.query(`DELETE FROM roles WHERE is_system = true AND org_id IS NULL`);
    await queryRunner.query(`DELETE FROM permissions`);
  }
}
