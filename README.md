# Sistema de Gestión Documental — Backend

Plataforma de gestión documental multi-tenant basada en microservicios.
Cuatro ambientes: local (KinD), dev, test y prod (los tres últimos en Railway).

---

## Arquitectura

```
Frontend (puerto 3001)
        │
        ▼
  Kong API Gateway (:8080)          ← único punto de entrada externo
        │
        ├── /api/auth/*    → auth-service        (NestJS + PostgreSQL + Redis)
        ├── /api/users/*   → user-service         (NestJS + PostgreSQL + Redis)
        ├── /api/org/*     → org-service          (NestJS + PostgreSQL)
        ├── /api/documents/* → document-service  (NestJS + MongoDB + MinIO)
        ├── /api/workflows/* → workflow-service  (NestJS + PostgreSQL + Kafka)
        ├── /api/notifications/* → notification-service (NestJS + Redis + Kafka)
        └── /api/audit/*   → audit-service       (NestJS + Elasticsearch + Kafka)

Infraestructura (Docker Compose en local / Helm en prod):
  PostgreSQL · MongoDB · Redis · Kafka · MinIO · Elasticsearch
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + NestJS 10 |
| API Gateway | Kong 3.4 (DB-less, declarativo) |
| Orquestación | Kubernetes — KinD (local) |
| Auth | JWT HS256 (access + refresh con rotación) |
| BD relacional | PostgreSQL 15 |
| BD documental | MongoDB 7 |
| Caché / sesiones | Redis 7 |
| Mensajería | Apache Kafka (KRaft, sin Zookeeper) |
| Object storage | MinIO (compatible S3) |
| Búsqueda / auditoría | Elasticsearch 8 |

---

## Estructura del proyecto

```
document-management-system/
├── kind-config.yaml              # Cluster KinD: 1 control-plane + 2 workers
├── docker-compose.yml            # Infraestructura local (DBs, Kafka, MinIO, ES)
│
├── docker/
│   └── postgres-init/
│       └── init-databases.sh     # Crea DBs y usuarios al iniciar PostgreSQL
│
├── k8s/                          # Manifiestos Kubernetes
│   ├── namespaces/               # gestor-documental · sgd-infra · sgd-monitoring
│   ├── external-services/        # ExternalName: puente Kind → Docker Compose
│   ├── api-gateway/              # Kong: configmap, deployment, service, secret
│   ├── auth-service/             # configmap, deployment, service, secret
│   ├── user-service/
│   ├── org-service/
│   ├── document-service/
│   ├── workflow-service/
│   ├── notification-service/
│   └── audit-service/
│
├── helm/
│   └── values/                   # Values de Helm para infraestructura en prod
│
└── services/                     # Código fuente de los microservicios
    └── auth-service/             # NestJS — autenticación y credenciales
        ├── Dockerfile
        ├── src/
        │   ├── main.ts
        │   ├── app.module.ts
        │   ├── auth/             # controller, service, DTOs, entity
        │   ├── health/           # /health/startup · /health/live · /health/ready
        │   └── redis/            # módulo Redis global
        └── .env.example
```

---

## Prerrequisitos

| Herramienta | Versión mínima | Instalación |
|---|---|---|
| Docker Desktop | 20+ | https://www.docker.com/products/docker-desktop |
| KinD | 0.17+ | `choco install kind` o https://kind.sigs.k8s.io |
| kubectl | 1.25+ | incluido en Docker Desktop |
| Node.js | 20+ | https://nodejs.org |
| Git | — | https://git-scm.com |

---

## Ejecución en Local

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd document-management-system
```

### 2. Levantar infraestructura (Docker Compose)

```bash
docker compose up -d

# Verificar que todos los servicios están healthy (~60 segundos)
docker compose ps
```

Servicios disponibles tras arrancar:

| Servicio | URL |
|---|---|
| PostgreSQL | localhost:5432 |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |
| Kafka | localhost:9094 |
| Kafka UI | http://localhost:8090 |
| MinIO Console | http://localhost:9001 (admin: `minio_admin` / `minio_secret_local`) |
| Elasticsearch | http://localhost:9200 |

### 3. Crear el cluster KinD

```bash
kind create cluster --config kind-config.yaml

# Verificar los 3 nodos
kubectl get nodes
```

### 4. Aplicar manifiestos Kubernetes

```bash
# Namespaces
kubectl apply -f k8s/namespaces/

# Puentes ExternalName (Kind → Docker Compose)
kubectl apply -f k8s/external-services/

# API Gateway (Kong)
kubectl apply -f k8s/api-gateway/

# Configs y secrets de cada microservicio
kubectl apply -f k8s/auth-service/
kubectl apply -f k8s/user-service/
kubectl apply -f k8s/org-service/
kubectl apply -f k8s/document-service/
kubectl apply -f k8s/workflow-service/
kubectl apply -f k8s/notification-service/
kubectl apply -f k8s/audit-service/
```

### 5. Construir y desplegar microservicios

Por cada servicio en `services/`:

```bash
# Ejemplo con auth-service
cd services/auth-service
cp .env.example .env        # completar con valores locales
npm install
npm run build

cd ../..
docker build -t auth-service:1.0.0 ./services/auth-service
kind load docker-image auth-service:1.0.0 --name sgd-local
kubectl rollout restart deployment/auth-service -n gestor-documental
```

### 6. Desarrollo activo (sin Docker/K8s)

Para iterar rápido en un servicio individual, córrelo directo en la máquina:

```bash
cd services/auth-service
cp .env.example .env   # DB_HOST=localhost, REDIS_HOST=localhost, etc.
npm run start:dev      # hot-reload con watch
```

El servicio queda disponible en `http://localhost:3000`.
Kong en `:8080` sigue siendo el punto de entrada para probar el flujo completo.

---

## API — Endpoints principales

Todas las rutas pasan por Kong en `http://localhost:8080`.
Las rutas marcadas con `JWT` requieren header `Authorization: Bearer <token>`.

### Auth Service

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/credentials/provision` | `x-internal-token` | Crea credenciales (llamado por user-service) |
| POST | `/api/auth/login` | `x-company-id` header | Login → devuelve accessToken + refreshToken |
| POST | `/api/auth/refresh` | — | Rota el refresh token |
| GET | `/api/auth/me` | JWT | Retorna identidad del usuario autenticado |

---

## Ambientes en Railway (dev / test / prod)

Railway es un PaaS: no usa Kubernetes. Cada microservicio es un servicio
independiente dentro de un proyecto Railway con 3 entornos separados.

> Los secrets NUNCA se almacenan en el repositorio.
> Se configuran por entorno en el dashboard de Railway o vía Railway CLI.

### Estrategia de ramas → entornos

```
Rama git          Entorno Railway    Uso
─────────────────────────────────────────────────────
develop     ──►   dev                Desarrollo activo, datos de prueba
test        ──►   test               QA, pruebas de integración
main        ──►   prod               Producción, datos reales
local       ──►   (KinD)             Máquina del desarrollador
```

**Flujo de trabajo:**
```
feature/xxx  →  develop  →  test  →  main
                  │            │        │
                 dev          test     prod
             (Railway)   (Railway)  (Railway)
```

Railway despliega automáticamente cuando se hace push/merge a cada rama.

### Diferencias clave: Local vs Railway

| Aspecto | Local (KinD) | Producción (Railway) |
|---|---|---|
| Orquestación | Kubernetes (KinD) | Railway (PaaS interno) |
| DNS interno | `service.namespace.svc.cluster.local` | `service.railway.internal:3000` |
| Infraestructura | Docker Compose fuera del cluster | Plugins nativos de Railway |
| Kong config | `k8s/api-gateway/configmap.yaml` | `railway/api-gateway/kong.yaml` |
| Secrets | `k8s/*/secret.yaml` (valores dev) | Variables de entorno en Railway dashboard |
| Imágenes | `kind load` (sin registry) | Railway construye desde el repo git |

### Estructura de archivos para Railway

```
railway/
└── api-gateway/
    ├── kong.yaml         # Rutas con DNS interno de Railway
    ├── Dockerfile        # Imagen Kong con kong.yaml embebido
    ├── entrypoint.sh     # Sustituye env vars en kong.yaml al arrancar
    └── railway.json      # Health check config para Railway

services/
└── auth-service/
    ├── Dockerfile        # El mismo Dockerfile (Railway lo usa directamente)
    └── railway.json      # Health check: /health/ready
```

### Paso 1 — Crear el proyecto y los 3 entornos en Railway

1. Ir a [railway.app](https://railway.app) → **New Project**
2. Conectar el repositorio de GitHub
3. En Railway → **Environments** → crear los 3 entornos:

```
Nombre      Rama git    NODE_ENV
──────────────────────────────────
dev         develop     development
test        test        test
prod        main        production
```

4. Para cada entorno, en **Settings → Branch**, asignar la rama correspondiente.
   Railway redesplegará automáticamente en cada push a esa rama.

### Paso 2 — Agregar infraestructura por entorno

**Cada entorno (dev, test, prod) necesita su propia instancia de cada servicio.**
Esto garantiza aislamiento total: dev nunca toca datos de prod.

**Plugins nativos de Railway** (agregar en cada entorno):

| Plugin | Entornos | Uso |
|---|---|---|
| **PostgreSQL** | dev + test + prod | auth, user, org, workflow |
| **Redis** | dev + test + prod | auth, user, notification |
| **MongoDB** | dev + test + prod | document-service |

**Servicios con imagen Docker** (no son plugins nativos):

| Servicio | Imagen | Entornos |
|---|---|---|
| Kafka | `apache/kafka:latest` | dev + test + prod |
| MinIO | `minio/minio:latest` | dev + test + prod |
| Elasticsearch | `docker.elastic.co/elasticsearch/elasticsearch:8.11.0` | dev + test + prod |

> **Alternativas externas para reducir costos:**
> - Kafka → [Upstash Kafka](https://upstash.com) (tier gratuito disponible)
> - MinIO → [Cloudflare R2](https://developers.cloudflare.com/r2) (S3-compatible, 10GB gratis)
> - Elasticsearch → solo en test y prod (dev puede omitirlo si no usas auditoría)

### Paso 3 — Desplegar el API Gateway (Kong)

1. En Railway, crear un nuevo servicio → **Empty Service**
2. Conectar al repo, establecer **Root Directory**: `railway/api-gateway`
3. Railway detecta el `Dockerfile` automáticamente
4. Configurar las variables de entorno del servicio:

```
KONG_JWT_SECRET   = <mismo valor que JWT_SECRET de auth-service>
FRONTEND_URL      = https://<tu-dominio-frontend>
```

### Paso 4 — Desplegar cada microservicio

Para cada servicio (ejemplo con auth-service):

1. En Railway crear un nuevo servicio → conectar repo
2. **Root Directory**: `services/auth-service`
3. Railway usa el `Dockerfile` y el `railway.json` (health check en `/health/ready`)
4. Configurar variables de entorno en el dashboard de Railway:

**auth-service — variables de entorno en Railway (por entorno):**

Railway usa la sintaxis `${{Plugin.VARIABLE}}` para referenciar automáticamente
los valores de los plugins conectados al mismo entorno.

```
# ── Común a todos los entornos ─────────────────────────────────────────
PORT                   = 3000
JWT_EXPIRATION         = 3600s
JWT_REFRESH_EXPIRATION = 7d
DB_NAME                = auth_db

# ── Varía por entorno ──────────────────────────────────────────────────

# dev
NODE_ENV               = development

# test
NODE_ENV               = test

# prod
NODE_ENV               = production

# ── Generadas automáticamente por Railway al conectar los plugins ──────
DB_HOST                = ${{Postgres.PGHOST}}
DB_PORT                = ${{Postgres.PGPORT}}
DB_USERNAME            = ${{Postgres.PGUSER}}
DB_PASSWORD            = ${{Postgres.PGPASSWORD}}
REDIS_HOST             = ${{Redis.REDISHOST}}
REDIS_PORT             = ${{Redis.REDISPORT}}
REDIS_PASSWORD         = ${{Redis.REDISPASSWORD}}

# ── Secrets — valor diferente por entorno (nunca compartir entre entornos) ──
JWT_SECRET             = <openssl rand -base64 32>
JWT_REFRESH_SECRET     = <openssl rand -base64 32>
INTERNAL_TOKEN         = <openssl rand -base64 32>
```

> **Regla de oro de los secrets:**
> `JWT_SECRET` de dev ≠ `JWT_SECRET` de test ≠ `JWT_SECRET` de prod.
> Un token de dev nunca debe ser válido en prod.

### Paso 5 — URLs públicas por entorno

Railway asigna URLs automáticamente a cada entorno del API Gateway:

```
Entorno   URL generada por Railway                          Dominio propio (opcional)
───────────────────────────────────────────────────────────────────────────────────
dev       https://api-gateway-dev-xxxx.up.railway.app       api-dev.tudominio.com
test      https://api-gateway-test-xxxx.up.railway.app      api-test.tudominio.com
prod      https://api-gateway-prod-xxxx.up.railway.app      api.tudominio.com
```

Configurar dominio propio: Railway → servicio api-gateway → **Settings → Domains**.

### Paso 6 — Railway CLI (flujo diario)

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Enlazar el proyecto local
railway link

# Ver variables del entorno dev
railway variables --environment dev

# Ver logs del auth-service en dev
railway logs --service auth-service --environment dev

# Cambiar entre entornos
railway environment dev
railway environment test
railway environment prod
```

### Generar secrets seguros

```bash
# Generar un secret diferente para cada entorno
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # JWT_REFRESH_SECRET
openssl rand -base64 32   # INTERNAL_TOKEN
```

---

## Comandos útiles

```bash
# Ver estado de todos los pods
kubectl get pods -n gestor-documental

# Logs de un servicio en tiempo real
kubectl logs deployment/auth-service -n gestor-documental -f

# Logs del API Gateway (Kong)
kubectl logs deployment/api-gateway -n gestor-documental -f

# Verificar rutas de Kong
curl http://localhost:8001/routes

# Reiniciar un pod tras actualizar la imagen
kubectl rollout restart deployment/<nombre> -n gestor-documental

# Parar toda la infraestructura local
docker compose down
kind delete cluster --name sgd-local
```
