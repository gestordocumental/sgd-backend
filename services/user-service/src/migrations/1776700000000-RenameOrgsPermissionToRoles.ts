import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameOrgsPermissionToRoles1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "permissions_module_enum" RENAME VALUE 'ORGS' TO 'ROLES'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "permissions_module_enum" RENAME VALUE 'ROLES' TO 'ORGS'`,
    );
  }
}
