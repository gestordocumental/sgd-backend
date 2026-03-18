import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRegistrationStatusToUsers1773824671815 implements MigrationInterface {
  name = "AddRegistrationStatusToUsers1773824671815";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the enum type only if it does not already exist.
    //    synchronize:true in dev mode may have already created it.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."users_registration_status_enum"
          AS ENUM('pending_credentials', 'active');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // 2. Add the column only if it does not already exist (PostgreSQL 9.6+).
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "registration_status"
          "public"."users_registration_status_enum"
          NOT NULL DEFAULT 'pending_credentials'
    `);

    // 3. Backfill: users that were already active before this migration
    //    are considered fully registered.
    await queryRunner.query(`
      UPDATE "users"
        SET "registration_status" = 'active'
        WHERE "is_active" = true
    `);

    // 4. New users start inactive until they complete registration.
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "is_active" SET DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "is_active" SET DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "registration_status"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."users_registration_status_enum"
    `);
  }
}
