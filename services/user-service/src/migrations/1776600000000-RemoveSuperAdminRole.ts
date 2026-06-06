import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the SUPER_ADMIN system role in all environments.
 *
 * The previous migration (1774692345732) already did this in production but
 * was skipped in dev/staging due to a NODE_ENV guard. This migration runs
 * unconditionally and is idempotent — safe to run even if the role no longer
 * exists (all deletes use subquery lookups that return nothing when missing).
 *
 * Note: super-admin capability is controlled by the isSuperAdmin flag on the
 * User entity, NOT by this DB role. Removing the role does not affect any
 * user's super-admin access.
 */
export class RemoveSuperAdminRole1776600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove permissions assigned to SUPER_ADMIN
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id = (SELECT id FROM roles WHERE name = 'SUPER_ADMIN' AND org_id IS NULL)
    `);

    // 2. Remove PLATFORM:MANAGE permission (may already be gone in production)
    await queryRunner.query(`
      DELETE FROM permissions WHERE module = 'PLATFORM' AND action = 'MANAGE'
    `);

    // 3. Remove the SUPER_ADMIN role row
    await queryRunner.query(`
      DELETE FROM roles WHERE name = 'SUPER_ADMIN' AND org_id IS NULL
    `);

    // 4. Drop PLATFORM from the module enum if it still exists (dev environments)
    const enumExists: { count: string }[] = await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'permissions_module_enum'
        AND e.enumlabel = 'PLATFORM'
    `);
    if (Number(enumExists[0]?.count) > 0) {
      await queryRunner.query(`ALTER TYPE permissions_module_enum RENAME TO permissions_module_enum_old`);
      await queryRunner.query(`
        CREATE TYPE permissions_module_enum AS ENUM (
          'DOCUMENTS','WORKFLOWS','USERS','ORGS','ORG_STRUCTURE','AUDIT'
        )
      `);
      await queryRunner.query(`
        ALTER TABLE permissions
          ALTER COLUMN module TYPE permissions_module_enum
          USING module::text::permissions_module_enum
      `);
      await queryRunner.query(`DROP TYPE permissions_module_enum_old`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore PLATFORM:MANAGE permission
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES (gen_random_uuid(), 'PLATFORM', 'MANAGE', 'Full platform access (super admin only)')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // Restore SUPER_ADMIN role
    await queryRunner.query(`
      INSERT INTO roles (id, name, scope, description, is_system, org_id, created_at)
      VALUES (gen_random_uuid(), 'SUPER_ADMIN', 'SYSTEM', 'Full platform access', true, NULL, NOW())
      ON CONFLICT (name, org_id) DO NOTHING
    `);

    // Re-assign all permissions to SUPER_ADMIN
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'SUPER_ADMIN' AND r.org_id IS NULL
      ON CONFLICT DO NOTHING
    `);
  }
}
