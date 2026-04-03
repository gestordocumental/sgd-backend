import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrgStructure1775300000000 implements MigrationInterface {
  name = 'CreateOrgStructure1775300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "departamentos" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "org_id"      UUID        NOT NULL,
        "name"        VARCHAR(255) NOT NULL,
        "description" TEXT,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMPTZ,
        CONSTRAINT "PK_departamentos" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_departamentos_org_id" ON "departamentos" ("org_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_departamentos_org_name"
        ON "departamentos" ("org_id", "name")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "areas" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "org_id"           UUID        NOT NULL,
        "departamento_id"  UUID        NOT NULL,
        "name"             VARCHAR(255) NOT NULL,
        "description"      TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "PK_areas" PRIMARY KEY ("id"),
        CONSTRAINT "FK_areas_departamento" FOREIGN KEY ("departamento_id")
          REFERENCES "departamentos" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_areas_org_id" ON "areas" ("org_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_areas_departamento_id" ON "areas" ("departamento_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_areas_departamento_name"
        ON "areas" ("departamento_id", "name")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "cargos" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "org_id"           UUID        NOT NULL,
        "area_id"          UUID        NOT NULL,
        "departamento_id"  UUID        NOT NULL,
        "name"             VARCHAR(255) NOT NULL,
        "description"      TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "PK_cargos" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cargos_area" FOREIGN KEY ("area_id")
          REFERENCES "areas" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cargos_org_id" ON "cargos" ("org_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cargos_area_id" ON "cargos" ("area_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cargos_departamento_id" ON "cargos" ("departamento_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cargos_area_name"
        ON "cargos" ("area_id", "name")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cargos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "areas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "departamentos"`);
  }
}
