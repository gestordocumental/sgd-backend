#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Railway PostgreSQL — Init Script
#
# Crea las 4 bases de datos que necesitan los microservicios.
# Se ejecuta una sola vez como servicio de Railway que sale con código 0.
#
# Variables de entorno requeridas (del plugin PostgreSQL de Railway):
#   PG_HOST     = ${{Postgres.PGHOST}}
#   PG_PORT     = ${{Postgres.PGPORT}}
#   PG_USER     = ${{Postgres.PGUSER}}
#   PG_PASSWORD = ${{Postgres.PGPASSWORD}}
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo ">>> Iniciando creación de bases de datos SGD en Railway PostgreSQL..."

export PGPASSWORD="$PG_PASSWORD"

run_sql() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "postgres" -c "$1"
}

# Crear cada DB solo si no existe (idempotente)
for DB in auth_db org_db user_db workflow_db; do
  EXISTS=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "postgres" \
    -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'")

  if [ "$EXISTS" = "1" ]; then
    echo "  ✓ $DB ya existe — omitiendo"
  else
    run_sql "CREATE DATABASE $DB;"
    echo "  ✓ $DB creada"
  fi
done

# Otorgar permisos al usuario Railway en cada DB
for DB in auth_db org_db user_db workflow_db; do
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB" \
    -c "GRANT ALL ON SCHEMA public TO \"$PG_USER\";" 2>/dev/null || true
done

echo ">>> Bases de datos SGD listas."
echo ">>> Este contenedor terminará ahora (exit 0 = Railway no lo reinicia)."
