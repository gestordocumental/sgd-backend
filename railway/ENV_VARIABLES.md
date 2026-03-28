# Variables de entorno por servicio y entorno

Referencia completa de todas las variables que se deben configurar
en Railway para cada entorno (dev / test / prod).

`${{Plugin.VAR}}` → Railway las inyecta automáticamente al conectar el plugin.
`<generar>`       → Generar con `openssl rand -base64 32` (valor distinto por entorno).

---

## auth-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `DB_HOST` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | Plugin |
| `DB_PORT` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | Plugin |
| `DB_NAME` | `auth_db` | `auth_db` | `auth_db` | Manual |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | Plugin |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | Plugin |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `JWT_SECRET` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `JWT_REFRESH_SECRET` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `JWT_EXPIRATION` | `3600s` | `3600s` | `3600s` | Manual |
| `JWT_REFRESH_EXPIRATION` | `7d` | `7d` | `7d` | Manual |
| `INTERNAL_TOKEN` | `<generar>` | `<generar>` | `<generar>` | Manual |

---

## user-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `DB_HOST` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | Plugin |
| `DB_PORT` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | Plugin |
| `DB_NAME` | `user_db` | `user_db` | `user_db` | Manual |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | Plugin |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | Plugin |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | Manual |
| `KAFKA_CLIENT_ID` | `user-service` | `user-service` | `user-service` | Manual |
| `KAFKA_GROUP_ID` | `user-service-group` | `user-service-group` | `user-service-group` | Manual |
| `INTERNAL_TOKEN` | mismo que auth-service | mismo que auth-service | mismo que auth-service | Manual |

---

## org-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `DB_HOST` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | Plugin |
| `DB_PORT` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | Plugin |
| `DB_NAME` | `org_db` | `org_db` | `org_db` | Manual |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | Plugin |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | Plugin |

---

## document-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `MONGODB_HOST` | `${{MongoDB.MONGOHOST}}` | `${{MongoDB.MONGOHOST}}` | `${{MongoDB.MONGOHOST}}` | Plugin |
| `MONGODB_PORT` | `${{MongoDB.MONGOPORT}}` | `${{MongoDB.MONGOPORT}}` | `${{MongoDB.MONGOPORT}}` | Plugin |
| `MONGODB_DB` | `document_db` | `document_db` | `document_db` | Manual |
| `MONGODB_USERNAME` | `${{MongoDB.MONGOUSER}}` | `${{MongoDB.MONGOUSER}}` | `${{MongoDB.MONGOUSER}}` | Plugin |
| `MONGODB_PASSWORD` | `${{MongoDB.MONGOPASSWORD}}` | `${{MongoDB.MONGOPASSWORD}}` | `${{MongoDB.MONGOPASSWORD}}` | Plugin |
| `MINIO_ENDPOINT` | `minio.railway.internal` | `minio.railway.internal` | `minio.railway.internal` | Manual |
| `MINIO_PORT` | `9000` | `9000` | `9000` | Manual |
| `MINIO_ACCESS_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `MINIO_SECRET_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `MINIO_BUCKET` | `documentos` | `documentos` | `documentos` | Manual |
| `KAFKA_BROKERS` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | Manual |
| `KAFKA_CLIENT_ID` | `document-service` | `document-service` | `document-service` | Manual |
| `KAFKA_GROUP_ID` | `document-service-group` | `document-service-group` | `document-service-group` | Manual |

---

## workflow-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `DB_HOST` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | Plugin |
| `DB_PORT` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | Plugin |
| `DB_NAME` | `workflow_db` | `workflow_db` | `workflow_db` | Manual |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | Plugin |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | Plugin |
| `KAFKA_BROKERS` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | Manual |
| `KAFKA_CLIENT_ID` | `workflow-service` | `workflow-service` | `workflow-service` | Manual |
| `KAFKA_GROUP_ID` | `workflow-service-group` | `workflow-service-group` | `workflow-service-group` | Manual |

---

## notification-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `KAFKA_BROKERS` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | `kafka.railway.internal:9092` | Manual |
| `KAFKA_CLIENT_ID` | `notification-service` | `notification-service` | `notification-service` | Manual |
| `KAFKA_GROUP_ID` | `notification-service-group` | `notification-service-group` | `notification-service-group` | Manual |
| `SMTP_HOST` | `smtp.sendgrid.net` | `smtp.sendgrid.net` | `smtp.sendgrid.net` | Manual |
| `SMTP_PORT` | `587` | `587` | `587` | Manual |
| `SMTP_USERNAME` | `apikey` | `apikey` | `apikey` | Manual |
| `SMTP_PASSWORD` | `<api-key-sendgrid-dev>` | `<api-key-sendgrid-test>` | `<api-key-sendgrid-prod>` | Manual |
| `EMAIL_FROM` | `dev-noreply@helisa.com` | `test-noreply@helisa.com` | `noreply@helisa.com` | Manual |

---

## audit-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `ELASTICSEARCH_NODE` | `http://elasticsearch.railway.internal:9200` | idem | idem | Manual |
| `ELASTICSEARCH_INDEX` | `sgd-audit-logs-dev` | `sgd-audit-logs-test` | `sgd-audit-logs` | Manual |
| `KAFKA_BROKERS` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `audit-service` | `audit-service` | `audit-service` | Manual |
| `KAFKA_GROUP_ID` | `audit-service-group` | `audit-service-group` | `audit-service-group` | Manual |

---

## api-gateway (Kong)

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `KONG_JWT_SECRET` | mismo que `JWT_SECRET` de auth-service dev | idem test | idem prod | Manual |
| `FRONTEND_URL` | `https://frontend-dev.up.railway.app` | `https://frontend-test.up.railway.app` | `https://app.tudominio.com` | Manual |

---

## Notas importantes

1. **Aislamiento total**: cada entorno tiene su propia BD, sus propios secrets, su propio Kafka.
   Un token JWT de `dev` no funciona en `test` ni en `prod`.

2. **INTERNAL_TOKEN**: debe ser el mismo valor en todos los servicios del mismo entorno,
   pero diferente entre entornos (dev ≠ test ≠ prod).

3. **KONG_JWT_SECRET** debe coincidir exactamente con `JWT_SECRET` del auth-service
   en el mismo entorno. Si cambia uno, cambia el otro.

4. **Elasticsearch en dev**: puede omitirse si no se necesita auditoría en desarrollo.
   El audit-service fallará su readiness probe pero los demás servicios seguirán funcionando.
