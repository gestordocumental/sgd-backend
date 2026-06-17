# Guía de Despliegue — Railway (3 Entornos)

Guía paso a paso para configurar dev, test y prod en Railway desde cero.

---

## Arquitectura de entornos

```
Rama git     Entorno Railway   NODE_ENV       URL Kong
──────────────────────────────────────────────────────────────
develop   →  dev               development    https://api-dev.railway.app
test      →  test              test           https://api-test.railway.app
main      →  prod              production     https://api.tudominio.com
```

## Flujo de promoción de código

```
feature/xxx
     │ PR
     ▼
  develop ──── CI valida ────► Railway despliega en dev
     │
     │ PR (tests manuales OK)
     ▼
   test ──── CI valida ────► Railway despliega en test
     │
     │ PR (QA aprueba + GitHub approval gate)
     ▼
   main ──── CI valida ────► Railway despliega en prod
```

---

## FASE 1 — Configurar el repositorio GitHub

### 1.1 Crear las ramas base

```bash
git checkout -b develop
git push origin develop

git checkout -b test
git push origin test

# main ya existe
```

### 1.2 Configurar Branch Protection Rules en GitHub

Ir a: **repo → Settings → Branches → Add rule**

**Para `test`:**
- Branch name pattern: `test`
- ✅ Require status checks: `CI OK`
- ✅ Require branches to be up to date

**Para `main`:**
- Branch name pattern: `main`
- ✅ Require status checks: `CI OK`
- ✅ Require pull request reviews: 1 approver
- ✅ Require review from Code Owners
- ✅ Dismiss stale pull request approvals

### 1.3 Configurar GitHub Environment para approval de prod

Ir a: **repo → Settings → Environments → New environment**

- Nombre: `production`
- ✅ Required reviewers: agregar el/los aprobadores
- ✅ Wait timer: 0 minutos (o más si quieres un delay)

Esto hace que el workflow `promote-to-prod.yml` espere aprobación manual
antes de que el PR a `main` pueda ser mergeado.

---

## FASE 2 — Crear el proyecto Railway

### 2.1 Crear proyecto

1. Ir a [railway.app](https://railway.app) → **New Project**
2. Seleccionar **Deploy from GitHub repo**
3. Conectar tu repositorio
4. **No** configurar el servicio inicial aún — cerrar ese wizard

### 2.2 Crear los 3 entornos

En Railway: **proyecto → Environments (esquina superior)**

Crear:
- `prod` (Railway crea `production` por defecto, renombrarlo a `prod`)
- `test`
- `dev`

**Vincular cada entorno a su rama:**
- Cada servicio → Settings → Source → Branch:
  - entorno `dev`  → rama `develop`
  - entorno `test` → rama `test`
  - entorno `prod` → rama `main`

---

## FASE 3 — Infraestructura por entorno

Repetir estos pasos en los 3 entornos (dev, test, prod).
Cambiar de entorno con el selector en la esquina superior de Railway.

### 3.1 Agregar plugins nativos

En cada entorno, **New Service → Database**:

| Plugin | Nombre en Railway | Para |
|---|---|---|
| PostgreSQL | `postgres` | auth, user, org, workflow |
| Redis | `redis` | auth, user, notification |
| MongoDB | `mongodb` | document-service |

### 3.2 Agregar servicios con imagen Docker

En cada entorno, **New Service → Docker Image**:

| Imagen | Nombre del servicio | Para |
|---|---|---|
| `apache/kafka:latest` | `kafka` | mensajería async |
| `docker.elastic.co/elasticsearch/elasticsearch:8.11.0` | `elasticsearch` | auditoría |

> **Storage (documentos y avatares)**: document-service, metadata-extractor-service y user-service
> usan **Cloudflare R2** directamente — no se necesita ningún servicio de almacenamiento en Railway.
> Crear los buckets en el dashboard de R2 y configurar las credenciales en cada servicio
> (ver `railway/ENV_VARIABLES.md`).

**Variables de entorno para Kafka:**
```
KAFKA_NODE_ID=1
KAFKA_PROCESS_ROLES=broker,controller
KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka.railway.internal:9092
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka.railway.internal:9093
KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER
KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT
KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1
KAFKA_AUTO_CREATE_TOPICS_ENABLE=false
```

**Variables para Elasticsearch:**
```
discovery.type=single-node
xpack.security.enabled=false
ES_JAVA_OPTS=-Xms512m -Xmx512m
```

### 3.3 Correr el init de PostgreSQL (UNA VEZ por entorno)

Este servicio crea las 5 bases de datos (`auth_db`, `user_db`, `org_db`, `workflow_db`,
`notification_db`) y sale con código 0. Solo se necesita la primera vez.

En Railway, **New Service → GitHub Repo**:
- **Root Directory**: `railway/postgres-init`
- **Nombre del servicio**: `postgres-init`

**Variables de entorno** (referenciar el plugin postgres del mismo entorno):
```
PG_HOST     = ${{postgres.PGHOST}}
PG_PORT     = ${{postgres.PGPORT}}
PG_USER     = ${{postgres.PGUSER}}
PG_PASSWORD = ${{postgres.PGPASSWORD}}
PG_DATABASE = ${{postgres.PGDATABASE}}
```

> **Nota**: Railway no siempre crea la base de datos inicial con el nombre `postgres`.
> `PG_DATABASE` apunta a la BD por defecto real del plugin, que el script usa como punto de entrada para crear las demás.

Esperar que el servicio corra y salga con código 0.
Después de la primera ejecución exitosa, **eliminar este servicio** para no gastar recursos.

---

## FASE 4 — Desplegar los microservicios

### 4.1 API Gateway (Kong)

**New Service → GitHub Repo**
- **Root Directory**: `railway/api-gateway`
- **Nombre del servicio**: `api-gateway`
- Habilitar dominio público: **Settings → Networking → Generate Domain**

**Variables de entorno** (todas requeridas — `entrypoint.sh` aborta si alguna falta):
```env
KONG_DATABASE                             = off
KONG_JWT_SECRET                           = <mismo valor que JWT_SECRET del auth-service>
KONG_NGINX_PROXY_CLIENT_BODY_BUFFER_SIZE  = 10m
FRONTEND_URL                              = https://frontend-dev.up.railway.app  # ajustar por entorno
USER_RATE_LIMIT                           = 300
AUTH_SENSITIVE_RATE_LIMIT                 = 10
AUTH_SESSION_RATE_LIMIT                   = 2000
```

### 4.2 auth-service

**New Service → GitHub Repo**
- **Root Directory**: `services/auth-service`
- **Nombre del servicio**: `auth-service` ← CRÍTICO: debe coincidir con kong.yaml

**Variables de entorno** (ver `railway/ENV_VARIABLES.md` para la lista completa):
```
NODE_ENV                   = development|test|production
PORT                       = 3000
DB_HOST                    = ${{Postgres.PGHOST}}
DB_PORT                    = ${{Postgres.PGPORT}}
DB_NAME                    = auth_db
DB_USERNAME                = ${{Postgres.PGUSER}}
DB_PASSWORD                = ${{Postgres.PGPASSWORD}}
DB_POOL_SIZE               = 5
REDIS_HOST                 = ${{Redis.REDISHOST}}
REDIS_PORT                 = ${{Redis.REDISPORT}}
REDIS_PASSWORD             = ${{Redis.REDISPASSWORD}}
JWT_SECRET                 = <openssl rand -hex 32>
JWT_SECRET_KID             = v1
JWT_REFRESH_SECRET         = <openssl rand -hex 32>
JWT_REFRESH_SECRET_KID     = v1
JWT_EXPIRATION             = 3600s
JWT_REFRESH_EXPIRATION     = 7d
SUPER_ADMIN_EMAIL          = admin@empresa.com
SUPER_ADMIN_PASSWORD       = <openssl rand -hex 16>
INTERNAL_TOKEN_AUTH_USER   = <openssl rand -hex 32>   # mismo valor en user-service
INTERNAL_TOKEN_USER_AUTH   = <openssl rand -hex 32>   # mismo valor en user-service
INTERNAL_ALLOWED_CIDRS     = 100.64.0.0/10
USER_SERVICE_URL           = http://user-service.railway.internal:3000
KAFKA_BROKER               = kafka.railway.internal:9092
KAFKA_CLIENT_ID            = auth-service
```

### 4.3 Servicios restantes

Repetir el proceso del 4.2 para cada servicio, usando los nombres EXACTOS:
- `user-service`
- `org-service`
- `document-service`
- `metadata-extractor-service`
- `workflow-service`
- `notification-service`
- `audit-service`

Los nombres de los servicios en Railway deben coincidir exactamente con los
hostnames en `railway/api-gateway/kong.yaml`.

Consultar `railway/ENV_VARIABLES.md` para la lista completa de variables de cada servicio.
Puntos a tener en cuenta:
- **user-service**: necesita Redis y Kafka además de PostgreSQL.
- **notification-service**: necesita PostgreSQL, Redis y Kafka. Usa **Resend** para email (`RESEND_API_KEY`), no SMTP.
- **document-service**: necesita MongoDB (plugin), Kafka, credenciales de Cloudflare R2 y ClamAV
  (`CLAMAV_HOST`, `CLAMAV_PORT`; en prod `CLAMAV_REQUIRED=true`).
- **metadata-extractor-service**: no tiene base de datos propia; comparte bucket R2 con document-service (solo lectura).
- **audit-service**: en `NODE_ENV=production` requiere `ELASTICSEARCH_USERNAME/PASSWORD` genéricos **además** de los de rol (`WRITE_*`/`READ_*`). Si solo se configuran los de rol, el servicio crashea al arrancar.

---

## FASE 5 — Monitoring (solo entorno prod)

### 5.1 Prometheus

**New Service → GitHub Repo**
- **Root Directory**: `railway/monitoring`
- **Nombre del servicio**: `prometheus`

**Variables:**
```
ENVIRONMENT = prod
```

### 5.2 Grafana

**New Service → Docker Image**: `grafana/grafana:10.4.0`
- **Nombre del servicio**: `grafana`
- Habilitar dominio público

**Variables:**
```
GF_SECURITY_ADMIN_USER     = admin
GF_SECURITY_ADMIN_PASSWORD = <generar>
GF_SERVER_ROOT_URL         = https://<grafana-url>.railway.app
```

**Configurar datasource en Grafana:**
URL de Prometheus: `http://prometheus.railway.internal:9090`

---

## FASE 6 — CI/CD automático (GitHub Actions)

Los despliegues a Railway están completamente automatizados. Esta sección explica cómo funciona cada workflow y qué hacer en cada situación.

### 6.1 Flujo normal (push a una rama)

```text
git push origin feature/xxx
        │
        ▼
   PR hacia develop
        │
        ▼
   ci.yml  ←── runs on PR + push
   (lint, tests, build, security)
        │ CI OK ✓
        ▼
   merge a develop
        │
        ▼
   deploy-services.yml
   (detecta qué servicios cambiaron → despliega solo esos)
        │
        ▼
   Railway entorno: dev
```

El mismo patrón aplica para `develop → test` y `test → main`, con la diferencia de que el merge a `main` requiere aprobación manual (ver sección 6.3).

### 6.2 Qué hace `deploy-services.yml`

**Deploy inteligente por paths**: compara los archivos modificados en el commit y despliega únicamente los servicios afectados. Si el PR solo toca `services/workflow-service/`, los otros 8 servicios no se re-deployan.

| Ruta modificada | Servicio desplegado |
|---|---|
| `services/auth-service/**` | `auth-service` |
| `services/user-service/**` | `user-service` |
| `services/org-service/**` | `org-service` |
| `services/document-service/**` | `document-service` |
| `services/metadata-extractor-service/**` | `metadata-extractor-service` |
| `services/workflow-service/**` | `workflow-service` |
| `services/notification-service/**` | `notification-service` |
| `services/audit-service/**` | `audit-service` |
| `railway/api-gateway/**` | `api-gateway` |

**Mapeo rama → entorno Railway:**

| Rama | Entorno Railway | GitHub Environment |
|---|---|---|
| `develop` | `dev` | `dev` |
| `test` | `test` | `test` |
| `main` | `prod` | `production` |

**Secret requerido**: `RAILWAY_TOKEN` debe estar configurado en cada GitHub Environment (`dev`, `test`, `production`) en: **repo → Settings → Environments**.

### 6.3 Aprobar un deploy a producción

El merge a `master` está bloqueado por `promote-to-prod.yml`, que actúa como gate de calidad. **No despliega nada por sí solo** — solo exige aprobación antes de que el PR pueda mergearse.

Pasos para aprobar:

1. Se abre el PR de `test` → `main`
2. El workflow `promote-to-prod.yml` queda en estado **waiting**
3. El aprobador va a: **GitHub → Actions → el run de "Promote to Production" → Review deployments**
4. Selecciona el environment `production` y aprueba
5. El PR puede mergearse
6. `deploy-services.yml` detecta el push a `main` y despliega a prod en Railway

> Los reviewers autorizados se configuran en: **repo → Settings → Environments → production → Required reviewers**.

### 6.4 Deploy manual de un servicio específico

Útil para re-deplorar un servicio sin hacer push (por ejemplo, tras cambiar una variable de entorno en Railway o para forzar un redeploy de emergencia).

1. Ir a **GitHub → Actions → "Deploy - Microservicios" → Run workflow**
2. Seleccionar la rama (`develop`, `test` o `main`)
3. Elegir el servicio del desplegable
4. Ejecutar

El deploy manual usa el mismo `RAILWAY_TOKEN` y respeta el mismo mapeo rama → entorno Railway.

### 6.5 Generación automática de documentación de API

`generate-docs.yml` corre en cada push a `master` (después del deploy). Genera documentación HTML estática de la API usando Redocly y la commitea a `railway/api-docs/public/`.

**Cómo funciona:**
1. Hace login al API de producción para obtener un JWT
2. Llama a `/api/{service}/docs-json` en producción (Swagger JSON)
3. Convierte cada spec a HTML con `redocly build-docs`
4. Commit automático con mensaje `docs: regenerate API docs [skip ci]`

**Servicios incluidos:** auth, users, org, documents, metadata-extractor. Los servicios sin Swagger público (workflow, notification, audit) no generan docs.

**Secrets requeridos** (configurar en GitHub → Settings → Secrets):

| Secret | Valor |
|---|---|
| `PRODUCTION_API_URL` | URL pública del api-gateway en producción |
| `PRODUCTION_DOCS_EMAIL` | Email de la cuenta de servicio para autenticación |
| `PRODUCTION_DOCS_PASSWORD` | Contraseña de esa cuenta |

---

## FASE 7 — Verificación final

### Checklist por entorno

```bash
# 1. Kong responde
curl https://<api-gateway-url>/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -H "x-company-id: <uuid>" \
  -d '{"email":"test@test.com","password":"Test1234"}'

# 2. Verificar que Kong NO expone el admin
curl https://<api-gateway-url>:8001/status  # debe dar 404 o timeout

# 3. Verificar health de cada servicio
curl https://<api-gateway-url>/api/auth/health/ready  # Solo si Kong lo expone

# 4. En Railway dashboard: todos los servicios en verde
```

---

## Referencia rápida: nombres de servicios en Railway

Los nombres a continuación son OBLIGATORIOS — Railway los usa como hostname interno.
Si cambias el nombre en Railway, debes actualizar `railway/api-gateway/kong.yaml`.

| Nombre en Railway | Hostname interno | Puerto |
|---|---|---|
| `api-gateway` | `api-gateway.railway.internal` | 8000 |
| `auth-service` | `auth-service.railway.internal` | 3000 |
| `user-service` | `user-service.railway.internal` | 3000 |
| `org-service` | `org-service.railway.internal` | 3000 |
| `document-service` | `document-service.railway.internal` | 3000 |
| `metadata-extractor-service` | `metadata-extractor-service.railway.internal` | 3000 |
| `workflow-service` | `workflow-service.railway.internal` | 3000 |
| `notification-service` | `notification-service.railway.internal` | 3000 |
| `audit-service` | `audit-service.railway.internal` | 3000 |
| `postgres` | — | Plugin |
| `redis` | — | Plugin |
| `mongodb` | — | Plugin |
| `kafka` | `kafka.railway.internal` | 9092 |
| `elasticsearch` | `elasticsearch.railway.internal` | 9200 |
| `prometheus` | `prometheus.railway.internal` | 9090 |
| `grafana` | `grafana.railway.internal` | 3000 |

> **Storage**: no hay servicio de almacenamiento en Railway. document-service, metadata-extractor-service
> y user-service conectan directamente a Cloudflare R2 via credenciales S3-compatible.
