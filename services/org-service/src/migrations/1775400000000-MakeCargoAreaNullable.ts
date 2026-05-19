import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allows cargos to exist at the department level without an area.
 *
 * Changes:
 *  - Make cargo.area_id nullable (FK remains — NULL bypasses the constraint in PostgreSQL)
 *  - Replace (area_id, name) unique index with two partial indexes:
 *      • Area-level:  UNIQUE (area_id, name) WHERE area_id IS NOT NULL AND deleted_at IS NULL
 *      • Dept-level:  UNIQUE (departamento_id, name) WHERE area_id IS NULL AND deleted_at IS NULL
 */
export class MakeCargoAreaNullable1775400000000 implements MigrationInterface {
  name = 'MakeCargoAreaNullable1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old non-null unique index
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cargos_area_name"`);

    // 2. Make area_id nullable (FK stays — PostgreSQL allows nullable FK columns)
    await queryRunner.query(`ALTER TABLE "cargos" ALTER COLUMN "area_id" DROP NOT NULL`);

    // 3. Area-level uniqueness: same name cannot appear twice in the same area
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cargos_area_name"
        ON "cargos" ("area_id", "name")
        WHERE "area_id" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // 4. Dept-level uniqueness: same name cannot appear twice in the same dept without an area
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cargos_dept_name"
        ON "cargos" ("departamento_id", "name")
        WHERE "area_id" IS NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Abort if any department-level cargos (area_id IS NULL) exist — reimposing NOT NULL
    // would fail anyway, and silently deleting data during a rollback is unsafe.
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "cargos" WHERE "area_id" IS NULL`,
    ) as [{ count: number }];
    if (count > 0) {
      throw new Error(
        `Cannot roll back MakeCargoAreaNullable: ${count} cargo(s) have area_id = NULL. ` +
        'Remove or reassign them before running this rollback.',
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cargos_dept_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cargos_area_name"`);
    await queryRunner.query(`ALTER TABLE "cargos" ALTER COLUMN "area_id" SET NOT NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cargos_area_name"
        ON "cargos" ("area_id", "name")
        WHERE "deleted_at" IS NULL
    `);
  }
}
