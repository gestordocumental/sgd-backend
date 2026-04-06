import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgStructureFieldsToUsers1775500000000 implements MigrationInterface {
  name = 'AddOrgStructureFieldsToUsers1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "departamento_id" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD "area_id" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD "cargo_id" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "cargo_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "area_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "departamento_id"`);
  }
}
