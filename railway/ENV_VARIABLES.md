# Variables de entorno por servicio y entorno

Referencia completa de todas las variables que se deben configurar
en Railway para cada entorno (dev / test / prod).

`${{Plugin.VAR}}` → Railway las inyecta automáticamente al conectar el plugin.
`<generar>`       → Generar con `openssl rand -hex 32` (valor distinto por entorno).
`(opc)`           → Variable opcional; el servicio arranca sin ella pero la funcionalidad queda desactivada.

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
| `DB_POOL_SIZE` | `5` | `5` | `5` | Manual |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `JWT_SECRET` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_REFRESH_SECRET` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `JWT_REFRESH_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_REFRESH_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_REFRESH_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_EXPIRATION` | `3600s` | `3600s` | `3600s` | Manual |
| `JWT_REFRESH_EXPIRATION` | `7d` | `7d` | `7d` | Manual |
| `SUPER_ADMIN_EMAIL` | `admin@sgd.local` | `admin@sgd.local` | `admin@empresa.com` | Manual |
| `SUPER_ADMIN_PASSWORD` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_AUTH_USER` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_USER_AUTH` | mismo que user-service | idem | idem | Manual |
| `INTERNAL_ALLOWED_CIDRS` | `100.64.0.0/10` | `100.64.0.0/10` | `100.64.0.0/10` | Manual |
| `USER_SERVICE_URL` | `http://user-service.railway.internal:3000` | idem | idem | Manual |
| `BCRYPT_ROUNDS` | `12` | `12` | `12` | Manual |
| `THROTTLE_TTL` | `60000` | `60000` | `60000` | Manual |
| `THROTTLE_LIMIT` | `10` | `10` | `10` | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `auth-service` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

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
| `DB_POOL_SIZE` | `5` | `5` | `5` | Manual |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `SUPER_ADMIN_EMAIL` | `admin@sgd.local` | `admin@sgd.local` | `admin@empresa.com` | Manual |
| `INTERNAL_TOKEN_USER_AUTH` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_USER_ORG` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_AUTH_USER` | mismo que auth-service | idem | idem | Manual |
| `INTERNAL_TOKEN_NOTIF_USER` | mismo que notification-service | idem | idem | Manual |
| `INTERNAL_TOKEN_WORKFLOW_USER` | mismo que workflow-service | idem | idem | Manual |
| `INTERNAL_TOKEN_ORG_USER` | mismo que org-service | idem | idem | Manual |
| `INTERNAL_ALLOWED_CIDRS` | `100.64.0.0/10` | `100.64.0.0/10` | `100.64.0.0/10` | Manual |
| `AUTH_SERVICE_URL` | `http://auth-service.railway.internal:3000` | idem | idem | Manual |
| `ORG_SERVICE_URL` | `http://org-service.railway.internal:3000` | idem | idem | Manual |
| `STORAGE_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | idem | idem | Manual |
| `STORAGE_REGION` | `auto` | `auto` | `auto` | Manual |
| `STORAGE_ACCESS_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `STORAGE_SECRET_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `STORAGE_BUCKET` | `avatares` | `avatares` | `avatares` | Manual |
| `STORAGE_FORCE_PATH` | `false` | `false` | `false` | Manual |
| `STORAGE_PUBLIC_URL` | `https://pub-<hash>.r2.dev` | idem | idem | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `user-service` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

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
| `DB_POOL_SIZE` | `5` | `5` | `5` | Manual |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `INTERNAL_TOKEN_ORG_USER` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_NOTIF_ORG` | mismo que notification-service | idem | idem | Manual |
| `INTERNAL_TOKEN_DOC_ORG` | mismo que document-service | idem | idem | Manual |
| `INTERNAL_TOKEN_USER_ORG` | mismo que user-service | idem | idem | Manual |
| `INTERNAL_ALLOWED_CIDRS` | `100.64.0.0/10` | `100.64.0.0/10` | `100.64.0.0/10` | Manual |
| `USER_SERVICE_URL` | `http://user-service.railway.internal:3000` | idem | idem | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `org-service` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

---

## document-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `MONGODB_URI` | `${{MongoDB.MONGO_URL}}` | `${{MongoDB.MONGO_URL}}` | `${{MongoDB.MONGO_URL}}` | Plugin |
| `STORAGE_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | idem | idem | Manual |
| `STORAGE_REGION` | `auto` | `auto` | `auto` | Manual |
| `STORAGE_ACCESS_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `STORAGE_SECRET_KEY` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `STORAGE_BUCKET` | `documentos` | `documentos` | `documentos` | Manual |
| `STORAGE_FORCE_PATH` | `false` | `false` | `false` | Manual |
| `SIGNED_URL_EXPIRY` | `300` | `300` | `300` | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `document-service` | idem | idem | Manual |
| `KAFKA_CONSUMER_GROUP` | `document-service-group` | idem | idem | Manual |
| `ORG_SERVICE_URL` | `http://org-service.railway.internal:3000` | idem | idem | Manual |
| `INTERNAL_TOKEN_DOC_ORG` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_WORKFLOW_DOC` | mismo que workflow-service | idem | idem | Manual |
| `INTERNAL_ALLOWED_CIDRS` | `100.64.0.0/10` | `100.64.0.0/10` | `100.64.0.0/10` | Manual |
| `METADATA_EXTRACTOR_URL` | `http://metadata-extractor-service.railway.internal:3000` | idem | idem | Manual |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `CLAMAV_HOST` | `clamav.railway.internal` | idem | idem | Manual |
| `CLAMAV_PORT` | `3310` | `3310` | `3310` | Manual |
| `CLAMAV_TIMEOUT_MS` | `15000` | `15000` | `15000` | Manual |
| `CLAMAV_REQUIRED` | `false` | `false` | `true` | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

---

## metadata-extractor-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `STORAGE_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | idem | idem | Manual |
| `STORAGE_REGION` | `auto` | `auto` | `auto` | Manual |
| `STORAGE_ACCESS_KEY` | mismo que document-service | idem | idem | Manual |
| `STORAGE_SECRET_KEY` | mismo que document-service | idem | idem | Manual |
| `STORAGE_BUCKET` | `documentos` | `documentos` | `documentos` | Manual |
| `STORAGE_FORCE_PATH` | `false` | `false` | `false` | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `metadata-extractor-service` | idem | idem | Manual |
| `KAFKA_CONSUMER_GROUP` | `metadata-extractor-group` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

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
| `DB_POOL_SIZE` | `5` | `5` | `5` | Manual |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `INTERNAL_TOKEN_WORKFLOW_USER` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_WORKFLOW_DOC` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `DOCUMENT_SERVICE_URL` | `http://document-service.railway.internal:3000` | idem | idem | Manual |
| `USER_SERVICE_URL` | `http://user-service.railway.internal:3000` | idem | idem | Manual |
| `DOCUMENT_SERVICE_TIMEOUT_MS` | `5000` | `5000` | `5000` | Manual |
| `USER_SERVICE_TIMEOUT_MS` | `5000` | `5000` | `5000` | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `workflow-service` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

---

## notification-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | `${{Redis.REDISHOST}}` | Plugin |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | `${{Redis.REDISPORT}}` | Plugin |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | `${{Redis.REDISPASSWORD}}` | Plugin |
| `DB_HOST` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | `${{Postgres.PGHOST}}` | Plugin |
| `DB_PORT` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | `${{Postgres.PGPORT}}` | Plugin |
| `DB_NAME` | `notification_db` | `notification_db` | `notification_db` | Manual |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | `${{Postgres.PGUSER}}` | Plugin |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | `${{Postgres.PGPASSWORD}}` | Plugin |
| `DB_POOL_SIZE` | `5` | `5` | `5` | Manual |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `INTERNAL_TOKEN_NOTIF_USER` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `INTERNAL_TOKEN_NOTIF_ORG` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `USER_SERVICE_URL` | `http://user-service.railway.internal:3000` | idem | idem | Manual |
| `ORG_SERVICE_URL` | `http://org-service.railway.internal:3000` | idem | idem | Manual |
| `FRONTEND_URL` | `https://frontend-dev.up.railway.app` | `https://frontend-test.up.railway.app` | `https://app.tudominio.com` | Manual |
| `RESEND_API_KEY` | `re_xxx` | `re_xxx` | `re_xxx` | Manual |
| `RESEND_FROM` | `SGD Helisa <no-reply@helisa.com>` | idem | idem | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `notification-service` | idem | idem | Manual |
| `KAFKA_CONSUMER_GROUP` | `notification-service-group` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

---

## audit-service

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` | Manual |
| `PORT` | `3000` | `3000` | `3000` | Manual |
| `JWT_SECRET` | mismo que auth-service | idem | idem | Manual |
| `JWT_SECRET_KID` | `v1` | `v1` | `v1` | Manual |
| `JWT_SECRET_PREV` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `JWT_SECRET_PREV_KID` | *(vacío)* | *(vacío)* | *(vacío)* | Manual |
| `INTERNAL_TOKEN` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `ELASTICSEARCH_URL` | `http://elasticsearch.railway.internal:9200` | idem | idem | Manual |
| `ELASTICSEARCH_USERNAME` | `elastic` | `elastic` | `elastic` | Manual |
| `ELASTICSEARCH_PASSWORD` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `ELASTICSEARCH_WRITE_USERNAME` | `elastic` | `elastic` | `elastic` | Manual |
| `ELASTICSEARCH_WRITE_PASSWORD` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `ELASTICSEARCH_READ_USERNAME` | `elastic` | `elastic` | `elastic` | Manual |
| `ELASTICSEARCH_READ_PASSWORD` | `<generar>` | `<generar>` | `<generar>` | Manual |
| `KAFKA_BROKER` | `kafka.railway.internal:9092` | idem | idem | Manual |
| `KAFKA_CLIENT_ID` | `audit-service` | idem | idem | Manual |
| `KAFKA_CONSUMER_GROUP` | `audit-service-group` | idem | idem | Manual |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |
| `SENTRY_DSN` | *(vacío)* (opc) | *(vacío)* | *(vacío)* | Manual |

---

## api-gateway (Kong)

| Variable | dev | test | prod | Fuente |
|---|---|---|---|---|
| `KONG_DATABASE` | `off` | `off` | `off` | Manual |
| `KONG_JWT_SECRET` | mismo que `JWT_SECRET` de auth-service | idem | idem | Manual |
| `KONG_NGINX_PROXY_CLIENT_BODY_BUFFER_SIZE` | `10m` | `10m` | `10m` | Manual |
| `FRONTEND_URL` | `https://frontend-dev.up.railway.app` | `https://frontend-test.up.railway.app` | `https://app.tudominio.com` | Manual |
| `USER_RATE_LIMIT` | `300` | `300` | `300` | Manual |
| `AUTH_SENSITIVE_RATE_LIMIT` | `10` | `10` | `10` | Manual |
| `AUTH_SESSION_RATE_LIMIT` | `2000` | `2000` | `2000` | Manual |

---

## Notas importantes

1. **Aislamiento total**: cada entorno tiene su propia BD, sus propios secrets, su propio Kafka.
   Un token JWT de `dev` no funciona en `test` ni en `prod`.

2. **Tokens internos por par**: cada token identifica un par (origen → destino). El mismo valor
   debe configurarse en AMBOS servicios: el que lo envía y el que lo recibe.
   Ejemplo: `INTERNAL_TOKEN_AUTH_USER` debe ser idéntico en auth-service y en user-service.
   Nunca reutilizar el mismo valor entre pares distintos.

3. **`JWT_SECRET` compartido**: todos los servicios que validan tokens JWT deben tener el mismo
   `JWT_SECRET` (y `JWT_SECRET_KID`) que el auth-service del mismo entorno.
   Si cambia en auth-service, debe actualizarse en todos los demás servicios y en `KONG_JWT_SECRET`.

4. **`ELASTICSEARCH_USERNAME/PASSWORD`** (genéricos en audit-service): requeridos por el guard de
   producción en `main.ts`. Deben configurarse **además** de los de rol (`WRITE_*`/`READ_*`).
   Si solo se configuran los de rol, el servicio crashea al arrancar en `NODE_ENV=production`.

5. **`KAFKA_CONSUMER_GROUP`**: solo lo necesitan los servicios consumidores:
   document-service, metadata-extractor-service, notification-service y audit-service.
   auth-service, user-service, org-service y workflow-service son solo productores.

6. **MongoDB**: el plugin de MongoDB en Railway expone la URL completa como `MONGO_URL`.
   Usarla directamente: `MONGODB_URI=${{MongoDB.MONGO_URL}}`.

7. **metadata-extractor-service**: comparte el mismo bucket R2 que document-service
   (acceso de solo lectura). Usar las mismas credenciales de storage que document-service.

8. **`INTERNAL_TOKEN` del document-service**: el `JwtGuard` local valida el header
   `x-internal-token` contra este token genérico en cualquier ruta. Es independiente de
   `INTERNAL_TOKEN_WORKFLOW_DOC` (que usa `InternalGuard` solo en endpoints `/internal/*`).

9. **`KONG_CORS_ORIGIN_1`**: si aparece como variable heredada en Railway, puede eliminarse;
   no está referenciada en el `kong.yaml` de Railway (solo se usa en `docker/kong` local).
