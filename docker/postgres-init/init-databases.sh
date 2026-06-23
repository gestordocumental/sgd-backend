#!/bin/bash
# Script de inicialización de PostgreSQL.
# Se ejecuta automáticamente al crear el contenedor por primera vez.
# Crea las bases de datos y usuarios para cada microservicio (sección 3.3 — aislamiento).

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

  -- ── Bases de datos por microservicio ────────────────────────────────────────
  CREATE DATABASE auth_db;
  CREATE DATABASE org_db;
  CREATE DATABASE user_db;
  CREATE DATABASE workflow_db;
  CREATE DATABASE notification_db;

  -- ── Usuarios dedicados por servicio (principio de mínimo privilegio) ────────
  CREATE USER auth_user          WITH PASSWORD 'auth_pass_local';
  CREATE USER org_user           WITH PASSWORD 'org_pass_local';
  CREATE USER user_svc_user      WITH PASSWORD 'user_pass_local';
  CREATE USER workflow_user      WITH PASSWORD 'workflow_pass_local';
  CREATE USER notification_user  WITH PASSWORD 'notification_pass_local';

  -- ── Permisos a nivel de base de datos ────────────────────────────────────────
  GRANT ALL PRIVILEGES ON DATABASE auth_db          TO auth_user;
  GRANT ALL PRIVILEGES ON DATABASE org_db           TO org_user;
  GRANT ALL PRIVILEGES ON DATABASE user_db          TO user_svc_user;
  GRANT ALL PRIVILEGES ON DATABASE workflow_db      TO workflow_user;
  GRANT ALL PRIVILEGES ON DATABASE notification_db  TO notification_user;

EOSQL

# PostgreSQL 15+: GRANT DATABASE no otorga permisos sobre schema public.
# Cada \c requiere una conexión separada por base de datos.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "auth_db" \
  -c "GRANT ALL ON SCHEMA public TO auth_user;"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "org_db" \
  -c "GRANT ALL ON SCHEMA public TO org_user;"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "user_db" \
  -c "GRANT ALL ON SCHEMA public TO user_svc_user;"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "workflow_db" \
  -c "GRANT ALL ON SCHEMA public TO workflow_user;"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "notification_db" \
  -c "GRANT ALL ON SCHEMA public TO notification_user;"

echo ">>> Bases de datos SGD inicializadas correctamente."
