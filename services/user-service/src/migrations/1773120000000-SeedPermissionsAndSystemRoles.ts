import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the permissions catalog and system roles.
 * Permissions are static system data — not created by users.
 * Uses ON CONFLICT DO NOTHING for idempotency.
 */
export class SeedPermissionsAndSystemRoles1773120000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Permissions catalog ───────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO permissions (id, module, action, description)
      VALUES
        (gen_random_uuid(), 'DOCUMENTS', 'READ',     'Ver documentos'),
        (gen_random_uuid(), 'DOCUMENTS', 'WRITE',    'Crear y editar documentos'),
        (gen_random_uuid(), 'DOCUMENTS', 'DELETE',   'Eliminar documentos'),
        (gen_random_uuid(), 'DOCUMENTS', 'APPROVE',  'Aprobar documentos'),
        (gen_random_uuid(), 'DOCUMENTS', 'UPLOAD',   'Subir archivos'),
        (gen_random_uuid(), 'DOCUMENTS', 'DOWNLOAD', 'Descargar archivos'),

        (gen_random_uuid(), 'WORKFLOWS', 'READ',     'Ver flujos de trabajo'),
        (gen_random_uuid(), 'WORKFLOWS', 'WRITE',    'Crear y editar flujos'),
        (gen_random_uuid(), 'WORKFLOWS', 'DELETE',   'Eliminar flujos'),
        (gen_random_uuid(), 'WORKFLOWS', 'APPROVE',  'Aprobar pasos de flujo'),

        (gen_random_uuid(), 'USERS',     'READ',     'Ver usuarios'),
        (gen_random_uuid(), 'USERS',     'WRITE',    'Crear y editar usuarios'),
        (gen_random_uuid(), 'USERS',     'DELETE',   'Eliminar usuarios'),
        (gen_random_uuid(), 'USERS',     'MANAGE',   'Gestión completa de usuarios'),

        (gen_random_uuid(), 'ORGS',      'READ',     'Ver información de la organización'),
        (gen_random_uuid(), 'ORGS',      'WRITE',    'Editar información de la organización'),
        (gen_random_uuid(), 'ORGS',      'MANAGE',   'Gestión completa de la organización'),

        (gen_random_uuid(), 'AUDIT',     'READ',     'Ver registros de auditoría'),

        (gen_random_uuid(), 'PLATFORM',  'MANAGE',   'Acceso total a la plataforma (solo super admin)')
      ON CONFLICT (module, action) DO NOTHING
    `);

    // ── System roles ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles (id, name, scope, description, is_system, org_id, created_at)
      VALUES
        (gen_random_uuid(), 'SUPER_ADMIN', 'SYSTEM', 'Acceso total a la plataforma',          true, NULL, NOW()),
        (gen_random_uuid(), 'ADMIN',       'SYSTEM', 'Administrador de organización',          true, NULL, NOW()),
        (gen_random_uuid(), 'MANAGER',     'SYSTEM', 'Gestor con permisos de aprobación',      true, NULL, NOW()),
        (gen_random_uuid(), 'EDITOR',      'SYSTEM', 'Puede crear y editar documentos',        true, NULL, NOW()),
        (gen_random_uuid(), 'VIEWER',      'SYSTEM', 'Solo lectura',                           true, NULL, NOW())
      ON CONFLICT (name, org_id) DO NOTHING
    `);

    // ── Assign permissions to system roles ───────────────────────────────────
    // SUPER_ADMIN — all permissions
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'SUPER_ADMIN' AND r.org_id IS NULL
      ON CONFLICT DO NOTHING
    `);

    // ADMIN — all except PLATFORM:MANAGE
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'ADMIN' AND r.org_id IS NULL
        AND NOT (p.module = 'PLATFORM' AND p.action = 'MANAGE')
      ON CONFLICT DO NOTHING
    `);

    // MANAGER — documents (all), workflows (all), users (read), audit (read)
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'MANAGER' AND r.org_id IS NULL
        AND (
          p.module = 'DOCUMENTS'
          OR p.module = 'WORKFLOWS'
          OR (p.module = 'USERS'  AND p.action = 'READ')
          OR (p.module = 'AUDIT'  AND p.action = 'READ')
        )
      ON CONFLICT DO NOTHING
    `);

    // EDITOR — documents (read, write, upload, download), workflows (read)
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'EDITOR' AND r.org_id IS NULL
        AND (
          (p.module = 'DOCUMENTS' AND p.action IN ('READ', 'WRITE', 'UPLOAD', 'DOWNLOAD'))
          OR (p.module = 'WORKFLOWS' AND p.action = 'READ')
        )
      ON CONFLICT DO NOTHING
    `);

    // VIEWER — read-only on documents, workflows, audit
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'VIEWER' AND r.org_id IS NULL
        AND p.action = 'READ'
        AND p.module IN ('DOCUMENTS', 'WORKFLOWS', 'AUDIT')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE role_id IN (
        SELECT id FROM roles WHERE is_system = true AND org_id IS NULL
      )
    `);
    await queryRunner.query(`DELETE FROM roles WHERE is_system = true AND org_id IS NULL`);
    await queryRunner.query(`DELETE FROM permissions`);
  }
}
