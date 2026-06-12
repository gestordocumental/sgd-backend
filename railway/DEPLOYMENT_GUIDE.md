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
- `dev` (Railway crea `production` por defecto, renombrarlo a `prod`)
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
| `minio/minio:latest` | `minio` | almacenamiento docs |
| `docker.elastic.co/elasticsearch/elasticsearch:8.11.0` | `elasticsearch` | auditoría |

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

**Variables de entorno para MinIO:**
```
MINIO_ROOT_USER=<generar con openssl rand -base64 16>
MINIO_ROOT_PASSWORD=<generar con openssl rand -base64 32>
```
Comando de inicio: `server /data --console-address ":9001"`

**Variables para Elasticsearch:**
```
discovery.type=single-node
xpack.security.enabled=false
ES_JAVA_OPTS=-Xms512m -Xmx512m
```

### 3.3 Correr el init de PostgreSQL (UNA VEZ por entorno)

Este servicio crea las 4 bases de datos y sale. Solo se necesita la primera vez.

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

**Variables de entorno:**
```
# dev
KONG_JWT_SECRET = <mismo valor que JWT_SECRET del auth-service en dev>
FRONTEND_URL    = https://frontend-dev.up.railway.app

# test
KONG_JWT_SECRET = <mismo valor que JWT_SECRET del auth-service en test>
FRONTEND_URL    = https://frontend-test.up.railway.app

# prod
KONG_JWT_SECRET = <mismo valor que JWT_SECRET del auth-service en prod>
FRONTEND_URL    = https://app.tudominio.com
```

### 4.2 auth-service

**New Service → GitHub Repo**
- **Root Directory**: `services/auth-service`
- **Nombre del servicio**: `auth-service` ← CRÍTICO: debe coincidir con kong.yaml

**Variables de entorno** (ver `railway/ENV_VARIABLES.md` para la lista completa):
```
NODE_ENV               = development|test|production
PORT                   = 3000
DB_HOST                = ${{postgres.PGHOST}}
DB_PORT                = ${{postgres.PGPORT}}
DB_NAME                = auth_db
DB_USERNAME            = ${{postgres.PGUSER}}
DB_PASSWORD            = ${{postgres.PGPASSWORD}}
REDIS_HOST             = ${{redis.REDISHOST}}
REDIS_PORT             = ${{redis.REDISPORT}}
REDIS_PASSWORD         = ${{redis.REDISPASSWORD}}
JWT_SECRET             = <openssl rand -base64 32>
JWT_REFRESH_SECRET     = <openssl rand -base64 32>
JWT_EXPIRATION         = 3600s
JWT_REFRESH_EXPIRATION = 7d
INTERNAL_TOKEN         = <openssl rand -base64 32>
```

### 4.3 Servicios restantes

Repetir el proceso del 4.2 para cada servicio, usando los nombres EXACTOS:
- `user-service`
- `org-service`
- `document-service`
- `workflow-service`
- `notification-service`
- `audit-service`

Los nombres de los servicios en Railway deben coincidir exactamente con los
hostnames en `railway/api-gateway/kong.yaml`.

> **user-service requires Redis and Kafka** in addition to PostgreSQL.
> The invitation token flow stores one-time tokens in Redis; user events are
> published to Kafka. Make sure to add all variables listed in
> `railway/ENV_VARIABLES.md` — including `REDIS_*` and `KAFKA_*` — when
> configuring this service.

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

## FASE 6 — Verificación final

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
| `workflow-service` | `workflow-service.railway.internal` | 3000 |
| `notification-service` | `notification-service.railway.internal` | 3000 |
| `audit-service` | `audit-service.railway.internal` | 3000 |
| `postgres` | — | Plugin |
| `redis` | — | Plugin |
| `mongodb` | — | Plugin |
| `kafka` | `kafka.railway.internal` | 9092 |
| `minio` | `minio.railway.internal` | 9000 |
| `elasticsearch` | `elasticsearch.railway.internal` | 9200 |
| `prometheus` | `prometheus.railway.internal` | 9090 |
| `grafana` | `grafana.railway.internal` | 3000 |
