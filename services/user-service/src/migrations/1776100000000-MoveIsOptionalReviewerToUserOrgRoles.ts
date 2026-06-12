import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves is_optional_reviewer from the global users table to user_org_roles.
 * Previously the flag was a single boolean on users, making it bleed across
 * all organizations a user belongs to.  It must be per-user-per-org so that
 * a user can be an optional reviewer in org A but not in org B.
 */
export class MoveIsOptionalReviewerToUserOrgRoles1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the org-scoped column to user_org_roles (defaults to FALSE for new rows)
    await queryRunner.query(`
      ALTER TABLE "user_org_roles"
      ADD COLUMN IF NOT EXISTS "is_optional_reviewer" BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Propagate the old global flag into every org membership of each user.
    // A user marked as optional reviewer globally is set as such across all
    // their current org roles — the admin can narrow it down post-migration.
    // The column check MUST happen in TypeScript before the UPDATE is sent to
    // Postgres: the planner rejects a query that references a non-existent column
    // at parse/rewrite time, before any WHERE predicate is evaluated, so an
    // EXISTS sub-select inside the same statement cannot guard against the error.
    const [legacyCheck] = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'users'
          AND column_name = 'is_optional_reviewer'
      ) AS "exists"
    `);
    if (legacyCheck?.exists) {
      await queryRunner.query(`
        UPDATE "user_org_roles" uor
        SET "is_optional_reviewer" = u."is_optional_reviewer"
        FROM "users" u
        WHERE u.id = uor.user_id
      `);
    }

    // Drop the now-superseded global column from users
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "is_optional_reviewer"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the global column on users before dropping the per-org one so
    // the data is preserved: a user who was optional reviewer in ANY org gets
    // the flag back (BOOL_OR aggregation).
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_optional_reviewer" BOOLEAN NOT NULL DEFAULT FALSE
    `);
    const [orgRoleCheck] = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'user_org_roles'
          AND column_name = 'is_optional_reviewer'
      ) AS "exists"
    `);
    if (orgRoleCheck?.exists) {
      await queryRunner.query(`
        UPDATE "users" u
        SET "is_optional_reviewer" = src.has_optional_reviewer
        FROM (
          SELECT user_id, BOOL_OR(is_optional_reviewer) AS has_optional_reviewer
          FROM "user_org_roles"
          GROUP BY user_id
        ) src
        WHERE src.user_id = u.id
      `);
    }
    await queryRunner.query(`
      ALTER TABLE "user_org_roles" DROP COLUMN IF EXISTS "is_optional_reviewer"
    `);
  }
}
