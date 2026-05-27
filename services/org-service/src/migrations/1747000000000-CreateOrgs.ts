import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrgs1747000000000 implements MigrationInterface {
  name = 'CreateOrgs1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."orgs_status_enum" AS ENUM ('active', 'inactive')
    `);

    await queryRunner.query(`
      CREATE TABLE "orgs" (
        "id"         UUID              NOT NULL DEFAULT gen_random_uuid(),
        "name"       CHARACTER VARYING(255) NOT NULL,
        "nit"        CHARACTER VARYING(50),
        "address"    TEXT,
        "phone"      CHARACTER VARYING(50),
        "status"     "public"."orgs_status_enum" NOT NULL DEFAULT 'active',
        "created_by" UUID,
        "created_at" TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "PK_orgs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "orgs_name_uniq"
        ON "orgs" ("name")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "orgs_name_uniq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orgs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."orgs_status_enum"`);
  }
}
