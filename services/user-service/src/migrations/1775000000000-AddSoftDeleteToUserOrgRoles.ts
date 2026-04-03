import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSoftDeleteToUserOrgRoles1775000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_org_roles
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_org_roles
      DROP COLUMN IF EXISTS deleted_at
    `);
  }
}
