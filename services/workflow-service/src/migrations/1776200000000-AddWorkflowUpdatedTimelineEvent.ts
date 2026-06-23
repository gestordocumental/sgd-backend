import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowUpdatedTimelineEvent1776200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."timeline_event_type_enum"
        ADD VALUE IF NOT EXISTS 'WORKFLOW_UPDATED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values without recreating the type.
    // The safe approach is to leave the value in place on rollback.
  }
}
