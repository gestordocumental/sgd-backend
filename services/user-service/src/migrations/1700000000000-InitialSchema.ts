import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the base schema.
 * All subsequent migrations assume these tables and types exist.
 * Fully idempotent — safe to run on a DB that was previously created by
 * synchronize:true (local dev) or on a completely empty DB (Railway).
 * Constraint names must match what TypeORM auto-generated from the original
 * entity definitions (they are referenced by name in later migrations).
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types (IF NOT EXISTS via DO block) ────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."roles_scope_enum" AS ENUM ('SYSTEM', 'ORG');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // PLATFORM is removed by migration DeleteSuperAdminRole1774692345732,
    // but it must exist here so that SeedPermissionsAndSystemRoles1773120000000
    // can insert the PLATFORM:MANAGE permission.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."permissions_module_enum"
          AS ENUM ('DOCUMENTS', 'WORKFLOWS', 'USERS', 'ORGS', 'AUDIT', 'PLATFORM');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."permissions_action_enum"
          AS ENUM ('READ', 'WRITE', 'DELETE', 'APPROVE', 'UPLOAD', 'DOWNLOAD', 'MANAGE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── users ──────────────────────────────────────────────────────────────────
    // position: NOT NULL — MakePositionNullable1775500001000 drops the constraint later.
    // is_active DEFAULT true — AddRegistrationStatusToUsers1773824671815 changes it to false.
    // registration_status, departamento_id, area_id, cargo_id added by later migrations.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "email"              VARCHAR(255) NOT NULL,
        "first_name"         VARCHAR(100),
        "last_name"          VARCHAR(100),
        "id_number"          VARCHAR(50),
        "position"           VARCHAR(100) NOT NULL DEFAULT '',
        "is_active"          BOOLEAN      NOT NULL DEFAULT true,
        "is_super_admin"     BOOLEAN      NOT NULL DEFAULT false,
        "two_factor_enabled" BOOLEAN      NOT NULL DEFAULT false,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "deleted_at"         TIMESTAMPTZ,
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // Global unique index on email — replaced with partial index by
    // ReplaceEmailIndexWithPartialIndex1772994203515 (referenced by this exact name).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")
    `);

    // ── roles ──────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id"          UUID                        NOT NULL DEFAULT gen_random_uuid(),
        "name"        VARCHAR(100)                NOT NULL,
        "scope"       "public"."roles_scope_enum" NOT NULL,
        "description" TEXT,
        "is_system"   BOOLEAN NOT NULL DEFAULT false,
        "org_id"      UUID,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_roles_name_org_id" UNIQUE ("name", "org_id"),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_roles_org_id" ON "roles" ("org_id")
    `);

    // ── permissions ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "permissions" (
        "id"          UUID                               NOT NULL DEFAULT gen_random_uuid(),
        "module"      "public"."permissions_module_enum" NOT NULL,
        "action"      "public"."permissions_action_enum" NOT NULL,
        "description" TEXT,
        CONSTRAINT "UQ_permissions_module_action" UNIQUE ("module", "action"),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )
    `);

    // ── role_permissions (junction) ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "role_id"       UUID NOT NULL,
        "permission_id" UUID NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_id", "permission_id")
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "role_permissions"
          ADD CONSTRAINT "FK_role_permissions_role_id"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "role_permissions"
          ADD CONSTRAINT "FK_role_permissions_permission_id"
          FOREIGN KEY ("permission_id") REFERENCES "permissions"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── user_org_roles ─────────────────────────────────────────────────────────
    // role_id: NOT NULL — MakeRoleIdNullableInUserOrgRoles1775186318602 drops the constraint.
    // Unique was originally (user_id, org_id, role_id) — same migration changes it to (user_id, org_id).
    // Constraint names must be exact: they are referenced by name in migration 1775186318602.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_org_roles" (
        "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID NOT NULL,
        "org_id"      UUID NOT NULL,
        "role_id"     UUID NOT NULL,
        "assigned_by" UUID,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_8b7faa9d36151ec52426d498f85" UNIQUE ("user_id", "org_id", "role_id"),
        CONSTRAINT "PK_user_org_roles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_org_roles_user_id" ON "user_org_roles" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_org_roles_org_id" ON "user_org_roles" ("org_id")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user_org_roles"
          ADD CONSTRAINT "FK_user_org_roles_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    // FK name must be exact — dropped and re-added by MakeRoleIdNullableInUserOrgRoles1775186318602.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user_org_roles"
          ADD CONSTRAINT "FK_d8e5e7828e44142bc24f6b24301"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_org_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."permissions_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."permissions_module_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."roles_scope_enum"`);
  }
}
