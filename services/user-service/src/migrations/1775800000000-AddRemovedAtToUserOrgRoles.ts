import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRemovedAtToUserOrgRoles1775800000000 implements MigrationInterface {
  name = 'AddRemovedAtToUserOrgRoles1775800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_org_roles" ADD "removed_at" TIMESTAMPTZ NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_org_roles" DROP COLUMN "removed_at"`,
    );
  }
}
