import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds WORKFLOWS:WRITE and WORKFLOWS:APPROVE to the EDITOR system role.
 * EDITOR already has WORKFLOWS:READ; these two actions make the role useful
 * in the current UI while the document module is not yet available.
 */
export class AddWorkflowWriteApproveToEditor1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'EDITOR' AND r.org_id IS NULL
        AND p.module = 'WORKFLOWS'
        AND p.action IN ('WRITE', 'APPROVE')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id  = (SELECT id FROM roles       WHERE name   = 'EDITOR'   AND org_id IS NULL)
        AND permission_id IN (
          SELECT id FROM permissions
          WHERE module = 'WORKFLOWS' AND action IN ('WRITE', 'APPROVE')
        )
    `);
  }
}
