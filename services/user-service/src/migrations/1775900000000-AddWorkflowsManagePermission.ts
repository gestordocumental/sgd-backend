import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowsManagePermission1775900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Insert WORKFLOWS:MANAGE permission
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES (gen_random_uuid(), 'WORKFLOWS', 'MANAGE', 'View all organization workflows')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // 2. Assign to system roles ADMIN and MANAGER
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name IN ('ADMIN', 'MANAGER')
        AND r.org_id IS NULL
        AND p.module = 'WORKFLOWS'
        AND p.action = 'MANAGE'
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id = (
        SELECT id FROM permissions WHERE module = 'WORKFLOWS' AND action = 'MANAGE'
      )
    `);

    await queryRunner.query(`
      DELETE FROM permissions WHERE module = 'WORKFLOWS' AND action = 'MANAGE'
    `);
  }
}
