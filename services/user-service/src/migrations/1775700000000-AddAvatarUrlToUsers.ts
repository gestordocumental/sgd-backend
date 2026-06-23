import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvatarUrlToUsers1775700000000 implements MigrationInterface {
  name = 'AddAvatarUrlToUsers1775700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "avatar_url" varchar(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_url"`);
  }
}
