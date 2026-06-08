import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompositeIndexOrgIdUserIdOnUserOrgRoles1776200000000
  implements MigrationInterface
{
  name = 'AddCompositeIndexOrgIdUserIdOnUserOrgRoles1776200000000';

  // CONCURRENTLY cannot run inside a transaction
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index with org_id as the leading column.
    // The existing unique constraint (user_id, org_id) covers "get role of user in org"
    // and prefix scans by user_id, but cannot serve "list all users in org" efficiently.
    // This index closes that gap.
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_org_roles_org_id_user_id"
        ON "user_org_roles" ("org_id", "user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_user_org_roles_org_id_user_id"`,
    );
  }
}
