import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePositionNullable1775500001000 implements MigrationInterface {
  name = 'MakePositionNullable1775500001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "position" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows with null position get an empty string before restoring NOT NULL
    await queryRunner.query(`UPDATE "users" SET "position" = '' WHERE "position" IS NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "position" SET NOT NULL`);
  }
}
