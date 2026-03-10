import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemRoleNameUniqueIndex1741451800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial unique index: enforces name uniqueness for system roles (org_id IS NULL).
    // The existing unique constraint (name, org_id) does NOT cover this case
    // because NULL != NULL in SQL standard unique constraint semantics.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "roles_name_system_uniq"
      ON "roles" ("name")
      WHERE "org_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "roles_name_system_uniq"`);
  }
}
