import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves is_optional_reviewer from the global users table to user_org_roles.
 * Previously the flag was a single boolean on users, making it bleed across
 * all organizations a user belongs to.  It must be per-user-per-org so that
 * a user can be an optional reviewer in org A but not in org B.
 */
export class MoveIsOptionalReviewerToUserOrgRoles1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the org-scoped column to user_org_roles
    await queryRunner.query(`
      ALTER TABLE "user_org_roles"
      ADD COLUMN IF NOT EXISTS "is_optional_reviewer" BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Remove the now-incorrect global column from users.
    // Data is intentionally NOT migrated: the old flag was wrong (global) so
    // there is no meaningful per-org value to preserve.
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "is_optional_reviewer"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_org_roles" DROP COLUMN IF EXISTS "is_optional_reviewer"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_optional_reviewer" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }
}
