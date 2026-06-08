import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersReadToEditor1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON p.module = 'USERS' AND p.action = 'READ'
      WHERE r.name = 'EDITOR' AND r.org_id IS NULL AND r.is_system = true
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id = (SELECT id FROM roles WHERE name = 'EDITOR' AND org_id IS NULL AND is_system = true)
        AND permission_id = (SELECT id FROM permissions WHERE module = 'USERS' AND action = 'READ')
    `);
  }
}
