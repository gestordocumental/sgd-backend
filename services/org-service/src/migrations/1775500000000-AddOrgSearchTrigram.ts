import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgSearchTrigram1775500000000 implements MigrationInterface {
  name = 'AddOrgSearchTrigram1775500000000';

  // CONCURRENTLY no puede ejecutarse dentro de una transacción
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Habilitar la extensión pg_trgm (idempotente — no falla si ya existe)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Índice GIN trigram sobre name — cubre: name ILIKE '%query%'
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_orgs_name_trgm"
        ON "orgs" USING GIN ("name" gin_trgm_ops)
    `);

    // Índice GIN trigram sobre nit — cubre: nit ILIKE '%query%'
    // nit es nullable; GIN ignora NULLs automáticamente
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_orgs_nit_trgm"
        ON "orgs" USING GIN ("nit" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "idx_orgs_nit_trgm"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "idx_orgs_name_trgm"`);
    // No se elimina pg_trgm: otros servicios o índices pueden depender de ella
  }
}
