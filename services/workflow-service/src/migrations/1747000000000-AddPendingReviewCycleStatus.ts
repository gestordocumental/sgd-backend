import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingReviewCycleStatus1747000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."workflow_status_enum" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW_CYCLE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values directly.
    // A full migration would require recreating the type.
  }
}
