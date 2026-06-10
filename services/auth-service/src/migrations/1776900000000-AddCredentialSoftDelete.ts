import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds soft-delete support to credentials and replaces the global unique
 * constraint on email with a partial unique index covering only live rows.
 *
 * Why: a global unique constraint prevents email reuse after credential deletion.
 * A partial index (WHERE deleted_at IS NULL) enforces uniqueness for active rows
 * only, matching exactly what TypeORM's soft-delete auto-filter adds to queries.
 */
export class AddCredentialSoftDelete1776900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credentials"
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "credentials"
        DROP CONSTRAINT IF EXISTS "UQ_credentials_email"
    `);

    // Also drop any index TypeORM may have auto-created for @Index(["email"])
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credentials_email"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_credentials_email_active"
        ON "credentials" ("email")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credentials_email_active"`);

    // Soft-deleted rows cannot exist in the pre-migration schema (the column is
    // about to be dropped), and they may share an email with an active row —
    // which would violate the global unique constraint we are about to recreate.
    // Permanently remove them before restoring the constraint.
    //
    // ⚠️  WARNING: this rollback is destructive in production.
    // Do not run it if retaining soft-deleted credential records matters.
    await queryRunner.query(`
      DELETE FROM "credentials"
      WHERE "deleted_at" IS NOT NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "credentials"
          ADD CONSTRAINT "UQ_credentials_email" UNIQUE ("email");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "credentials"
        DROP COLUMN IF EXISTS "deleted_at"
    `);
  }
}
