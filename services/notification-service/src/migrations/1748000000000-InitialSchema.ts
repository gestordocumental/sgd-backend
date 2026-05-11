import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1748000000000 implements MigrationInterface {
  name = 'InitialSchema1748000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        UUID           NOT NULL,
        "type"           VARCHAR(60)    NOT NULL,
        "title"          VARCHAR(300)   NOT NULL,
        "message"        TEXT           NOT NULL,
        "workflow_id"    UUID,
        "workflow_title" VARCHAR(500),
        "read"           BOOLEAN        NOT NULL DEFAULT false,
        "read_at"        TIMESTAMPTZ,
        "metadata"       JSONB,
        "created_at"     TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_user_id"         ON "notifications" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_user_id_read"    ON "notifications" ("user_id", "read")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_created_at"      ON "notifications" ("created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
