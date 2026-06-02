import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteSuperAdminRole1774692345732 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
      // Guard 1: skip outside production — dev/staging may rely on this role for testing.
      // TypeORM still records the migration as applied, so there is no schema drift.
      if (process.env['NODE_ENV'] !== 'production') {
        return;
      }

      // Guard 2: abort if any users are still assigned to SUPER_ADMIN.
      // Resolve the assignments before re-running.
      const assigned: { count: number }[] = await queryRunner.query(`
        SELECT COUNT(*)::int AS count
        FROM user_org_roles
        WHERE role_id = (SELECT id FROM roles WHERE name = 'SUPER_ADMIN' AND org_id IS NULL)
      `);
      const assignedCount = assigned[0]?.count ?? 0;
      if (assignedCount > 0) {
        throw new Error(
          `DeleteSuperAdminRole: ${assignedCount} user(s) still assigned to SUPER_ADMIN — ` +
          'reassign or remove them before running this migration.',
        );
      }

      // 1. Desvincular permisos del rol SUPER_ADMIN
      await queryRunner.query(`
        DELETE FROM role_permissions
        WHERE role_id = (SELECT id FROM roles WHERE name = 'SUPER_ADMIN' AND org_id IS NULL)
      `);

      // 2. Eliminar el permiso PLATFORM:MANAGE
      await queryRunner.query(`
        DELETE FROM permissions WHERE module = 'PLATFORM' AND action = 'MANAGE'
      `);

      // 3. Eliminar el rol SUPER_ADMIN
      await queryRunner.query(`
        DELETE FROM roles WHERE name = 'SUPER_ADMIN' AND org_id IS NULL
      `);

      // 4. Eliminar PLATFORM del enum de la columna module si existe como tipo Postgres
      const enumExists = await queryRunner.query(`
        SELECT 1 FROM pg_type WHERE typname = 'permissions_module_enum'
      `);
      if (enumExists.length > 0) {
        await queryRunner.query(`ALTER TYPE permissions_module_enum RENAME TO permissions_module_enum_old`);
        await queryRunner.query(`CREATE TYPE permissions_module_enum AS ENUM ('DOCUMENTS','WORKFLOWS','USERS','ORGS','AUDIT')`);
        await queryRunner.query(`
          ALTER TABLE permissions ALTER COLUMN module TYPE permissions_module_enum
          USING module::text::permissions_module_enum
        `);
        await queryRunner.query(`DROP TYPE permissions_module_enum_old`);
      }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      // Restaurar enum con PLATFORM si existe como tipo Postgres
      const enumExists = await queryRunner.query(`
        SELECT 1 FROM pg_type WHERE typname = 'permissions_module_enum'
      `);
      if (enumExists.length > 0) {
        await queryRunner.query(`ALTER TYPE permissions_module_enum RENAME TO permissions_module_enum_old`);
        await queryRunner.query(`CREATE TYPE permissions_module_enum AS ENUM ('DOCUMENTS','WORKFLOWS','USERS','ORGS','AUDIT','PLATFORM')`);
        await queryRunner.query(`
          ALTER TABLE permissions ALTER COLUMN module TYPE permissions_module_enum
          USING module::text::permissions_module_enum
        `);
        await queryRunner.query(`DROP TYPE permissions_module_enum_old`);
      }
    }
  }
