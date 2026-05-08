import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema inicial completo del workflow-service.
 *
 * Idempotente — seguro de ejecutar sobre una BD creada por synchronize:true (dev local)
 * o sobre una BD vacía (Railway). Todos los CREATE usan IF NOT EXISTS y los tipos
 * se crean dentro de bloques DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$.
 */
export class InitialWorkflowSchema1714300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Extensión pgcrypto para gen_random_uuid() ────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ── Enum: workflow_status ─────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."workflow_status_enum" AS ENUM (
          'DRAFT',
          'PENDING_APPROVAL',
          'RETURNED_TO_CREATOR',
          'AVAILABLE_FOR_FINAL_USERS',
          'ADMIN_CYCLE_IN_PROGRESS',
          'CLOSED',
          'CANCELLED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: approval_step_status ────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."approval_step_status_enum" AS ENUM (
          'WAITING',
          'PENDING',
          'APPROVED',
          'REJECTED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: approval_action_type ────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."approval_action_type_enum" AS ENUM (
          'APPROVED',
          'REJECTED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: attachment_type ─────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."attachment_type_enum" AS ENUM (
          'MAIN_DOCUMENT',
          'SUPPORTING'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: admin_cycle_status ──────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."admin_cycle_status_enum" AS ENUM (
          'IN_PROGRESS',
          'COMPLETED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: admin_step_status ───────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."admin_step_status_enum" AS ENUM (
          'WAITING',
          'PENDING',
          'COMPLETED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Enum: timeline_event_type ─────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."timeline_event_type_enum" AS ENUM (
          'WORKFLOW_CREATED',
          'APPROVAL_STARTED',
          'STEP_APPROVED',
          'STEP_REJECTED',
          'WORKFLOW_RETURNED_TO_CREATOR',
          'WORKFLOW_RESUBMITTED',
          'WORKFLOW_APPROVED',
          'ATTACHMENT_ADDED',
          'NOTE_ADDED',
          'ADMIN_CYCLE_STARTED',
          'ADMIN_STEP_COMPLETED',
          'ADMIN_CYCLE_COMPLETED',
          'WORKFLOW_CLOSED',
          'WORKFLOW_CANCELLED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflows ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflows" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "org_id"                      UUID         NOT NULL,
        "title"                       VARCHAR(500) NOT NULL,
        "description"                 TEXT,
        "typology_id"                 VARCHAR(24)  NOT NULL,
        "typology_code"               VARCHAR(100) NOT NULL,
        "typology_version"            VARCHAR(50)  NOT NULL,
        "typology_name"               VARCHAR(500) NOT NULL,
        "main_document_id"            VARCHAR(255),
        "main_document_validated"     BOOLEAN      NOT NULL DEFAULT false,
        "main_document_metadata"      JSONB,
        "final_user_ids"              UUID[],
        "status"                      "public"."workflow_status_enum" NOT NULL DEFAULT 'DRAFT',
        "current_approval_step_order" INT,
        "rejected_at_step_id"         UUID,
        "current_assigned_user_id"    UUID,
        "active_admin_cycle_id"       UUID,
        "created_by"                  UUID         NOT NULL,
        "closed_by"                   UUID,
        "closed_at"                   TIMESTAMPTZ,
        "cancelled_by"                UUID,
        "cancelled_at"                TIMESTAMPTZ,
        "metadata"                    JSONB,
        "created_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "deleted_at"                  TIMESTAMPTZ,
        CONSTRAINT "PK_workflows" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflows_org_id_status"  ON "workflows" ("org_id", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflows_created_by"     ON "workflows" ("created_by")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflows_org_id"         ON "workflows" ("org_id")`);

    // ── Tabla: workflow_approval_steps ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_approval_steps" (
        "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"  UUID NOT NULL,
        "user_id"      UUID NOT NULL,
        "step_order"   INT  NOT NULL,
        "status"       "public"."approval_step_status_enum" NOT NULL DEFAULT 'WAITING',
        "completed_at" TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_approval_steps" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflow_approval_steps_workflow_order" UNIQUE ("workflow_id", "step_order")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_approval_steps_workflow_id" ON "workflow_approval_steps" ("workflow_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_approval_steps"
          ADD CONSTRAINT "FK_approval_steps_workflow_id"
          FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_approval_actions (inmutable) ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_approval_actions" (
        "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"    UUID NOT NULL,
        "step_id"        UUID NOT NULL,
        "user_id"        UUID NOT NULL,
        "action"         "public"."approval_action_type_enum" NOT NULL,
        "observations"   TEXT,
        "attempt_number" INT  NOT NULL DEFAULT 1,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_approval_actions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_approval_actions_workflow_id" ON "workflow_approval_actions" ("workflow_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_approval_actions_step_id"     ON "workflow_approval_actions" ("step_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_approval_actions"
          ADD CONSTRAINT "FK_approval_actions_step_id"
          FOREIGN KEY ("step_id") REFERENCES "workflow_approval_steps"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_attachments ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_attachments" (
        "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"     UUID         NOT NULL,
        "uploaded_by"     UUID         NOT NULL,
        "document_id"     VARCHAR(255) NOT NULL,
        "storage_key"     VARCHAR(500) NOT NULL,
        "original_name"   VARCHAR(500) NOT NULL,
        "mime_type"       VARCHAR(100) NOT NULL,
        "file_size_bytes" BIGINT,
        "attachment_type" "public"."attachment_type_enum" NOT NULL DEFAULT 'SUPPORTING',
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_attachments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflow_attachments_workflow_id" ON "workflow_attachments" ("workflow_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_attachments"
          ADD CONSTRAINT "FK_workflow_attachments_workflow_id"
          FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_admin_cycles ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_admin_cycles" (
        "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"         UUID NOT NULL,
        "cycle_number"        INT  NOT NULL DEFAULT 1,
        "initiated_by"        UUID NOT NULL,
        "status"              "public"."admin_cycle_status_enum" NOT NULL DEFAULT 'IN_PROGRESS',
        "current_step_order"  INT,
        "completed_at"        TIMESTAMPTZ,
        "metadata"            JSONB,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_admin_cycles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflow_admin_cycles_workflow_cycle" UNIQUE ("workflow_id", "cycle_number")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_cycles_workflow_id" ON "workflow_admin_cycles" ("workflow_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_admin_cycles"
          ADD CONSTRAINT "FK_admin_cycles_workflow_id"
          FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_admin_steps ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_admin_steps" (
        "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
        "cycle_id"     UUID NOT NULL,
        "workflow_id"  UUID NOT NULL,
        "user_id"      UUID NOT NULL,
        "step_order"   INT  NOT NULL,
        "status"       "public"."admin_step_status_enum" NOT NULL DEFAULT 'WAITING',
        "completed_at" TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_admin_steps" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workflow_admin_steps_cycle_order" UNIQUE ("cycle_id", "step_order")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_steps_cycle_id"    ON "workflow_admin_steps" ("cycle_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_steps_workflow_id" ON "workflow_admin_steps" ("workflow_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_admin_steps"
          ADD CONSTRAINT "FK_admin_steps_cycle_id"
          FOREIGN KEY ("cycle_id") REFERENCES "workflow_admin_cycles"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_admin_attachments ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_admin_attachments" (
        "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"     UUID         NOT NULL,
        "cycle_id"        UUID         NOT NULL,
        "step_id"         UUID         NOT NULL,
        "uploaded_by"     UUID         NOT NULL,
        "document_id"     VARCHAR(255) NOT NULL,
        "storage_key"     VARCHAR(500) NOT NULL,
        "original_name"   VARCHAR(500) NOT NULL,
        "mime_type"       VARCHAR(100) NOT NULL,
        "file_size_bytes" BIGINT,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_admin_attachments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_attachments_workflow_id" ON "workflow_admin_attachments" ("workflow_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_attachments_cycle_id"    ON "workflow_admin_attachments" ("cycle_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_attachments_step_id"     ON "workflow_admin_attachments" ("step_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_admin_attachments"
          ADD CONSTRAINT "FK_admin_attachments_step_id"
          FOREIGN KEY ("step_id") REFERENCES "workflow_admin_steps"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_notes ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_notes" (
        "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"   UUID NOT NULL,
        "cycle_id"      UUID,
        "admin_step_id" UUID,
        "created_by"    UUID NOT NULL,
        "content"       TEXT NOT NULL,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_notes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflow_notes_workflow_id" ON "workflow_notes" ("workflow_id")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_notes"
          ADD CONSTRAINT "FK_workflow_notes_workflow_id"
          FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_notes"
          ADD CONSTRAINT "FK_workflow_notes_admin_step_id"
          FOREIGN KEY ("admin_step_id") REFERENCES "workflow_admin_steps"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla: workflow_timeline ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_timeline" (
        "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
        "workflow_id"    UUID         NOT NULL,
        "event_type"     "public"."timeline_event_type_enum" NOT NULL,
        "actor_id"       UUID         NOT NULL,
        "target_user_id" UUID,
        "description"    TEXT         NOT NULL,
        "metadata"       JSONB,
        "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_timeline" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflow_timeline_workflow_id"   ON "workflow_timeline" ("workflow_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_workflow_timeline_workflow_date" ON "workflow_timeline" ("workflow_id", "created_at")`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "workflow_timeline"
          ADD CONSTRAINT "FK_workflow_timeline_workflow_id"
          FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_timeline"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_admin_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_admin_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_admin_cycles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_approval_actions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_approval_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflows"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."timeline_event_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."admin_step_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."admin_cycle_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."attachment_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."approval_action_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."approval_step_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."workflow_status_enum"`);
  }
}
