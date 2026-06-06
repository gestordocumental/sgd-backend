import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the AUDITOR system role with AUDIT:READ permission and removes
 * AUDIT:READ from the VIEWER role (viewers should not see audit logs).
 */
export class AddAuditorRole1776500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the AUDITOR system role
    await queryRunner.query(`
      INSERT INTO roles (id, name, scope, description, is_system, org_id, created_at)
      VALUES (gen_random_uuid(), 'AUDITOR', 'SYSTEM', 'Acceso de solo lectura al registro de auditoría', true, NULL, NOW())
      ON CONFLICT (name, org_id) DO NOTHING
    `);

    // 2. Assign AUDIT:READ to AUDITOR
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'AUDITOR' AND r.org_id IS NULL
        AND p.module = 'AUDIT' AND p.action = 'READ'
      ON CONFLICT DO NOTHING
    `);

    // 3. Remove AUDIT:READ from VIEWER
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id  = (SELECT id FROM roles       WHERE name = 'VIEWER' AND org_id IS NULL)
        AND permission_id = (SELECT id FROM permissions WHERE module = 'AUDIT' AND action = 'READ')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore AUDIT:READ on VIEWER
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'VIEWER' AND r.org_id IS NULL
        AND p.module = 'AUDIT' AND p.action = 'READ'
      ON CONFLICT DO NOTHING
    `);

    // Remove AUDITOR role (cascade deletes its role_permissions rows)
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id = (SELECT id FROM roles WHERE name = 'AUDITOR' AND org_id IS NULL)
    `);
    await queryRunner.query(`
      DELETE FROM roles WHERE name = 'AUDITOR' AND org_id IS NULL
    `);
  }
}
