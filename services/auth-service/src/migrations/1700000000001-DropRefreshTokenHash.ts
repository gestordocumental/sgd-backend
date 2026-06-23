import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the unused refresh_token_hash column from credentials.
 * Refresh token rotation is handled exclusively via Redis (refresh:{userId}:{jti} keys),
 * so this column was never written or read after the initial schema was created.
 */
export class DropRefreshTokenHash1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credentials"
        DROP COLUMN IF EXISTS "refresh_token_hash"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credentials"
        ADD COLUMN IF NOT EXISTS "refresh_token_hash" TEXT
    `);
  }
}
