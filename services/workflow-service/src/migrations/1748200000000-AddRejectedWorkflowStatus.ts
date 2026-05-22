import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRejectedWorkflowStatus1748200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."workflow_status_enum" ADD VALUE IF NOT EXISTS 'REJECTED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values directly.
    // A full migration would require recreating the type.
  }
}
