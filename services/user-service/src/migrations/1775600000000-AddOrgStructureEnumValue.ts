import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'ORG_STRUCTURE' to the permissions_module_enum PostgreSQL type.
 * Must be a separate migration from the INSERT that uses it because
 * PostgreSQL requires ALTER TYPE ADD VALUE to be committed before the new
 * value can be referenced in subsequent queries.
 */
export class AddOrgStructureEnumValue1775600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE permissions_module_enum ADD VALUE IF NOT EXISTS 'ORG_STRUCTURE'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support ALTER TYPE DROP VALUE.
    // The enum label is harmless once the rows that reference it are removed
    // by the companion migration's down().
  }
}
