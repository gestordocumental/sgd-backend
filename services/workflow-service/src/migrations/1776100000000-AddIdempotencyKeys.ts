import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyKeys1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_idempotency_keys" (
        "idem_key"   VARCHAR(255)             NOT NULL,
        "user_id"    UUID                     NOT NULL,
        "response"   TEXT                     NOT NULL,
        "expires_at" TIMESTAMPTZ              NOT NULL,
        "created_at" TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
        CONSTRAINT "pk_workflow_idempotency_keys" PRIMARY KEY ("idem_key")
      )
    `);

    /* Índice para limpieza periódica de entradas expiradas */
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workflow_idempotency_keys_expires_at"
      ON "workflow_idempotency_keys" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_idempotency_keys"`);
  }
}
