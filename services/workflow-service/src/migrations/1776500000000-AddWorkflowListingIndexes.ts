import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte de índices para "Mis tareas" / "Mis flujos" (MGESTDOC — paginación
 * de getMyTasks/getMyAvailable): antes de esta migración, esas consultas
 * dependían de un `.take(100)` en el backend sin índices dedicados, lo que
 * además de ocultar flujos fuera de los primeros 100 por fecha, forzaba un
 * seq scan sobre "workflows" en cada carga.
 *
 * - GIN sobre final_user_ids: soporta `:userId = ANY(w.final_user_ids)`
 *   (el camino de "usuario final" en getMyAvailable), que sin índice hace
 *   seq scan completo de la tabla por organización.
 * - btree compuesto (org_id, status, updated_at): soporta el filtro por
 *   organización + estado(s) ya existente más el ORDER BY updated_at DESC
 *   que ahora pagina de verdad, evitando un sort en memoria sobre todas las
 *   filas que matchean antes de aplicar LIMIT/OFFSET.
 */
export class AddWorkflowListingIndexes1776500000000 implements MigrationInterface {
  name = 'AddWorkflowListingIndexes1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflows_final_user_ids"
        ON "workflows" USING GIN ("final_user_ids")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workflows_org_status_updated_at"
        ON "workflows" ("org_id", "status", "updated_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workflows_org_status_updated_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workflows_final_user_ids"`);
  }
}
