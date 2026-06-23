import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgToNotifications1748100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD COLUMN IF NOT EXISTS "org_id"   UUID         DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "org_name" VARCHAR(300) DEFAULT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_org_id"
        ON "notifications" ("org_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_org_id"`);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        DROP COLUMN IF EXISTS "org_id",
        DROP COLUMN IF EXISTS "org_name"
    `);
  }
}
