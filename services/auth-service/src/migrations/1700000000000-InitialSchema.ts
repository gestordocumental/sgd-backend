import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the credentials table.
 * Fully idempotent — safe to run on a DB that was previously created by
 * synchronize:true (local dev) or on a completely empty DB (Railway).
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."credentials_status_enum" AS ENUM ('active', 'disabled');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credentials" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "email"              VARCHAR(255) NOT NULL,
        "user_id"            UUID         NOT NULL,
        "password_hash"      TEXT,
        "status"             "public"."credentials_status_enum" NOT NULL DEFAULT 'active',
        "refresh_token_hash" TEXT,
        "locked_until"       TIMESTAMPTZ,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credentials" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "credentials"
          ADD CONSTRAINT "UQ_credentials_email" UNIQUE ("email");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "credentials"
          ADD CONSTRAINT "UQ_credentials_user_id" UNIQUE ("user_id");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "credentials"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."credentials_status_enum"`);
  }
}
