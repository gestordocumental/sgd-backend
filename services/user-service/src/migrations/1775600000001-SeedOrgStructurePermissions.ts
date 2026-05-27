import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds ORG_STRUCTURE permissions and assigns them to system roles.
 * Depends on AddOrgStructureEnumValue1775600000000 having run first.
 * Uses ON CONFLICT DO NOTHING for idempotency.
 *
 * Role assignments:
 *   SUPER_ADMIN — READ + WRITE + DELETE
 *   ADMIN       — READ + WRITE + DELETE
 *   MANAGER     — READ + WRITE + DELETE
 *   EDITOR      — READ
 *   VIEWER      — READ
 */
export class SeedOrgStructurePermissions1775600000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── New permissions ───────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES
        (gen_random_uuid(), 'ORG_STRUCTURE', 'READ',   'View departments, areas and positions'),
        (gen_random_uuid(), 'ORG_STRUCTURE', 'WRITE',  'Create and edit departments, areas and positions'),
        (gen_random_uuid(), 'ORG_STRUCTURE', 'DELETE', 'Delete departments, areas and positions')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // ── SUPER_ADMIN gets all permissions (catch-up for new rows) ─────────────
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'SUPER_ADMIN' AND r.org_id IS NULL
        AND p.module = 'ORG_STRUCTURE'
      ON CONFLICT DO NOTHING
    `);

    // ── ADMIN — full org-structure access ─────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'ADMIN' AND r.org_id IS NULL
        AND p.module = 'ORG_STRUCTURE'
      ON CONFLICT DO NOTHING
    `);

    // ── MANAGER — full org-structure access ───────────────────────────────────
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'MANAGER' AND r.org_id IS NULL
        AND p.module = 'ORG_STRUCTURE'
      ON CONFLICT DO NOTHING
    `);

    // ── EDITOR — read-only ────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'EDITOR' AND r.org_id IS NULL
        AND p.module = 'ORG_STRUCTURE' AND p.action = 'READ'
      ON CONFLICT DO NOTHING
    `);

    // ── VIEWER — read-only ────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'VIEWER' AND r.org_id IS NULL
        AND p.module = 'ORG_STRUCTURE' AND p.action = 'READ'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (
        SELECT id FROM permissions WHERE module = 'ORG_STRUCTURE'
      )
    `);
    await queryRunner.query(`DELETE FROM permissions WHERE module = 'ORG_STRUCTURE'`);
    // NOTE: The enum value 'ORG_STRUCTURE' remains in permissions_module_enum —
    // PostgreSQL does not support ALTER TYPE DROP VALUE.
  }
}
