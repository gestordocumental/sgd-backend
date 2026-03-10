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
        │                           ← genera x-correlation-id por request
        ├── /api/auth/*        → auth-service        (NestJS + PostgreSQL + Redis)
        ├── /api/users/*       → user-service        (NestJS + PostgreSQL)
        ├── /api/roles/*       → user-service        (NestJS + PostgreSQL)
        ├── /api/permissions/* → user-service        (NestJS + PostgreSQL)
        ├── /api/org/*         → org-service         (NestJS + PostgreSQL)
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
| Auth | JWT HS256 (access + refresh con rotación atómica) |
| BD relacional | PostgreSQL 15 |
| BD documental | MongoDB 7 |
| Caché / sesiones | Redis 7 |
| Mensajería | Apache Kafka (KRaft, sin Zookeeper) |
| Object storage | MinIO (compatible S3) |
| Búsqueda / auditoría | Elasticsearch 8 |
| Trazabilidad | `x-correlation-id` propagado por Kong a todos los servicios |

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
│   ├── auth-service/
│   ├── user-service/
│   ├── org-service/
│   ├── document-service/
│   ├── workflow-service/
│   ├── notification-service/
│   └── audit-service/
│
├── railway/                      # Configuración específica para Railway (PaaS)
│   ├── api-gateway/
│   │   ├── kong.yaml             # Rutas con DNS interno de Railway
│   │   ├── Dockerfile            # Imagen Kong (usuario no-root, puerto 8080)
│   │   ├── entrypoint.sh         # Sustituye env vars en kong.yaml al arrancar
│   │   └── railway.json
│   └── api-docs/
│       ├── Dockerfile            # Nginx con basic auth (usuario no-root, puerto 8080)
│       ├── nginx.conf            # Sirve docs en /; /health sin auth para Railway
│       ├── entrypoint.sh         # Genera .htpasswd en /tmp en runtime (no expone password)
│       ├── railway.json
│       └── public/               # HTML estático con la documentación de la API
│
├── helm/
│   └── values/                   # Values de Helm para infraestructura en prod
│
└── services/
    ├── auth-service/             # Autenticación global, credenciales, JWT
    │   ├── Dockerfile
    │   ├── src/
    │   │   ├── auth/             # controller, service, DTOs, entities
    │   │   ├── data-source.ts    # DataSource para CLI de TypeORM (migraciones)
    │   │   ├── migrations/       # Migraciones TypeORM
    │   │   ├── health/
    │   │   └── redis/
    │   └── .env.example
    │
    └── user-service/             # Usuarios, roles, permisos por org
        ├── Dockerfile
        ├── src/
        │   ├── users/            # CRUD de usuarios + soft delete + restore
        │   │   └── dto/          # CreateUserDto, UpdateUserDto (con @Transform), UserResponseDto, SetSuperAdminDto
        │   ├── roles/            # Roles SYSTEM/ORG + permisos por módulo/acción
        │   │   └── permissions.seeder.ts  # Siembra catálogo de permisos en cada arranque
        │   ├── data-source.ts    # DataSource para CLI de TypeORM (migraciones)
        │   ├── migrations/       # Migraciones TypeORM
        │   ├── auth-client/      # HTTP client hacia auth-service
        │   ├── common/
        │   │   ├── decorators/   # @OrgId(), @RequireSuperAdmin()
        │   │   └── ...           # Logger Winston, correlation middleware, interceptors
        │   └── health/
        └── .env.example
```

---

## Modelo de usuarios y roles

### Identidad global (auth-service)

Un usuario tiene **una única credencial global** (email + password). La asociación a empresas se maneja mediante roles, no en las credenciales.

```
credentials (auth_db)
  email         UNIQUE GLOBAL       ← un email = una identidad
  userId        UNIQUE              ← FK lógica hacia users (user_db)
  passwordHash
  status        ACTIVE | DISABLED
```

### Usuarios y roles (user-service)

```text
users (user_db)
  email         UNIQUE PARCIAL WHERE deleted_at IS NULL   ← compatible con soft delete
  position
  isActive
  isSuperAdmin                      ← bypassa todas las validaciones de org
  deletedAt                         ← soft delete (restore disponible)

roles
  name + orgId  UNIQUE              ← mismo nombre en distintas orgs
  name          UNIQUE WHERE org_id IS NULL   ← unicidad de roles de sistema

user_org_roles                      ← un usuario puede pertenecer a N orgs con N roles
  userId + orgId + roleId  UNIQUE
```

### Jerarquía de roles

| Rol | Scope | orgId | Modificable |
|---|---|---|---|
| `SUPER_ADMIN` | SYSTEM | null | No |
| `ADMIN` | SYSTEM | null | No |
| `MANAGER` | SYSTEM | null | No |
| `EDITOR` | SYSTEM | null | No |
| `VIEWER` | SYSTEM | null | No |
| Roles custom | ORG | uuid de la org | Sí (si no hay usuarios asignados) |

### Permisos disponibles

| Módulo | Acciones |
|---|---|
| `DOCUMENTS` | READ, WRITE, DELETE, APPROVE, UPLOAD, DOWNLOAD |
| `WORKFLOWS` | READ, WRITE, DELETE, APPROVE |
| `USERS` | READ, WRITE, DELETE, MANAGE |
| `ORGS` | READ, WRITE, MANAGE |
| `AUDIT` | READ |
| `PLATFORM` | MANAGE (exclusivo SUPER_ADMIN) |

---

## Flujo de autenticación

```text
1. login()
   POST /api/auth/login { email, password }
   → token global: { sub, email, isSuperAdmin? }   (sin companyId)

2. GET /api/auth/me/companies
   → lista de orgIds del usuario

3. switchCompany()
   POST /api/auth/switch-company { companyId }
   → token scoped: { sub, email, companyId, isSuperAdmin? }

4. refresh()
   POST /api/auth/refresh { refreshToken }
   → nuevo par de tokens preservando companyId e isSuperAdmin
   → rotación atómica con Redis GETDEL (previene replay attacks)
```

> `isSuperAdmin` coexiste con `companyId` en el mismo token. Un super admin
> que cambia a una org mantiene sus privilegios globales.

---

## Seguridad implementada

| Área | Mecanismo |
|---|---|
| Validación JWT | `jwtService.verify()` en cada ruta protegida (defensa en profundidad contra bypass de Kong) |
| Rotación de refresh token | `GETDEL` atómico en Redis — previene replay con requests concurrentes |
| Token interno entre servicios | Comparación `timingSafeEqual` (previene timing attacks) |
| Contraseña en htpasswd | `htpasswd -i` con stdin — nunca expuesta en argv/ps |
| Contenedor api-docs | Corre como usuario `nginx` (no root), puerto 8080 |
| Respuestas de usuarios | `UserResponseDto` expone solo campos seguros (filtra `twoFactorEnabled`, `deletedAt`, `orgRoles`) |
| Escalada de privilegios | `@RequireSuperAdmin()` decodifica el JWT del caller — solo super admins pueden promover/revocar otros super admins |
| Normalización de entrada | `@Transform` en DTOs: email (lowercase+trim), idNumber (uppercase+trim), strings (trim) |

---

## Trazabilidad distribuida

Kong genera un `x-correlation-id` (UUID) para cada request entrante y lo propaga
a todos los microservicios como header. Cada servicio:

1. Lee el header en `CorrelationMiddleware` (fallback a UUID local si no viene)
2. Lo almacena en `AsyncLocalStorage` para el ciclo de vida del request
3. Lo incluye en cada línea de log via `AppLogger`
4. Lo devuelve en la respuesta HTTP

Esto permite filtrar los logs de una request completa en todos los servicios
usando un único ID.

**CORS**: `x-correlation-id` está en `headers` (el cliente puede enviarlo) y en
`exposed_headers` (el browser puede leerlo desde la response).

---

## Migraciones de base de datos

Los servicios con TypeORM tienen configurado el CLI de migraciones:

```bash
# Generar migración desde cambios en entidades
npm run migration:generate -- src/migrations/NombreMigracion

# Aplicar migraciones pendientes
npm run migration:run

# Revertir la última migración
npm run migration:revert

# Ver estado de todas las migraciones
npm run migration:show
```

> En `NODE_ENV=development` TypeORM usa `synchronize: true` para iterar rápido.
> En cualquier otro entorno las migraciones son obligatorias.

> **Permisos**: el catálogo de permisos del sistema NO requiere migraciones. Se sincroniza
> automáticamente en cada arranque desde `permissions.seeder.ts`. Para agregar un permiso:
> 1. Agregar el valor al enum (`PermissionModule` o `PermissionAction`) en `permission.entity.ts`
> 2. Agregar la entrada al `PERMISSIONS_CATALOG` en `permissions.seeder.ts`
> 3. Hacer deploy — el seeder lo inserta en el próximo arranque.

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
kubectl apply -f k8s/namespaces/
kubectl apply -f k8s/external-services/
kubectl apply -f k8s/api-gateway/
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
| POST | `/api/auth/login` | — | Login global → accessToken + refreshToken |
| POST | `/api/auth/refresh` | — | Rota el refresh token (GETDEL atómico) |
| GET | `/api/auth/me` | JWT | Identidad del usuario autenticado |
| GET | `/api/auth/me/companies` | JWT | Lista de orgIds del usuario |
| POST | `/api/auth/switch-company` | JWT | Token scoped a una empresa específica |

### User Service

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/users` | JWT | Crear usuario |
| GET | `/api/users` | JWT | Listar usuarios |
| GET | `/api/users/:id` | JWT | Obtener usuario |
| GET | `/api/users/by-email/:email` | JWT | Buscar por email |
| PATCH | `/api/users/:id` | JWT | Actualizar usuario |
| DELETE | `/api/users/:id` | JWT | Soft delete de usuario |
| POST | `/api/users/:id/restore` | JWT | Restaurar usuario eliminado |
| POST | `/api/users/:id/provision` | JWT | Provisionar credenciales en auth-service |
| POST | `/api/users/:id/restore` | JWT | Restaurar usuario eliminado |
| PATCH | `/api/users/:id/super-admin` | JWT (super admin) | Promover/revocar super admin |
| GET | `/api/users/:id/companies` | `x-internal-token` | Orgs del usuario (uso interno) |

> `PATCH /api/users/:id/super-admin` requiere que el caller tenga `isSuperAdmin: true`
> en su JWT. Solo un super admin puede promover o revocar a otro.
>
> Las respuestas de usuarios exponen `isSuperAdmin` (necesario para que auth-service
> incluya el claim en el JWT) pero filtran `twoFactorEnabled`, `deletedAt` y `orgRoles`.

### Roles y Permisos (User Service)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/permissions` | JWT | Catálogo completo de permisos del sistema |
| GET | `/api/roles` | JWT + `x-org-id` | Roles de sistema + roles custom de la org |
| POST | `/api/roles` | JWT + `x-org-id` | Crear rol custom en la org |
| GET | `/api/roles/:id` | JWT + `x-org-id` | Obtener rol |
| PATCH | `/api/roles/:id` | JWT + `x-org-id` | Actualizar rol (solo roles ORG) |
| DELETE | `/api/roles/:id` | JWT + `x-org-id` | Eliminar rol (falla si tiene usuarios asignados) |
| POST | `/api/roles/:id/permissions` | JWT + `x-org-id` | Reemplazar todos los permisos de un rol |
| DELETE | `/api/roles/:id/permissions/:permId` | JWT + `x-org-id` | Quitar un permiso de un rol |

> El header `x-org-id` lo inyecta Kong desde el claim `companyId` del JWT.
> En pruebas directas al servicio se debe enviar manualmente.
>
> El catálogo de permisos se siembra automáticamente en cada arranque del servicio
> via `PermissionsSeeder` (`OnApplicationBootstrap`). Para agregar un nuevo permiso
> basta con añadirlo al enum y al catálogo en `permissions.seeder.ts` — sin migraciones.

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

### Diferencias clave: Local vs Railway

| Aspecto | Local (KinD) | Producción (Railway) |
|---|---|---|
| Orquestación | Kubernetes (KinD) | Railway (PaaS interno) |
| DNS interno | `service.namespace.svc.cluster.local` | `service.railway.internal:3000` |
| Infraestructura | Docker Compose fuera del cluster | Plugins nativos de Railway |
| Kong config | `k8s/api-gateway/configmap.yaml` | `railway/api-gateway/kong.yaml` |
| Secrets | `k8s/*/secret.yaml` (valores dev) | Variables de entorno en Railway dashboard |
| Imágenes | `kind load` (sin registry) | Railway construye desde el repo git |

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

### Paso 2 — Agregar infraestructura por entorno

**Plugins nativos de Railway** (agregar en cada entorno):

| Plugin | Entornos | Uso |
|---|---|---|
| **PostgreSQL** | dev + test + prod | auth, user, org, workflow |
| **Redis** | dev + test + prod | auth, notification |
| **MongoDB** | dev + test + prod | document-service |

**Servicios con imagen Docker:**

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
2. Conectar al repo — Railway usa `dockerfilePath` de `railway.json` automáticamente
3. Configurar las variables de entorno:

```
KONG_JWT_SECRET   = <mismo valor que JWT_SECRET de auth-service>
FRONTEND_URL      = https://<tu-dominio-frontend>
```

### Paso 4 — Desplegar cada microservicio

Para cada servicio (ejemplo con auth-service):

1. En Railway crear un nuevo servicio → conectar repo
2. Railway usa el `Dockerfile` y el `railway.json` (health check en `/health`)
3. Configurar variables de entorno en el dashboard:

**auth-service:**

```text
PORT                   = 3000
JWT_EXPIRATION         = 3600s
JWT_REFRESH_EXPIRATION = 7d
DB_NAME                = auth_db
NODE_ENV               = production          # varía por entorno

# Generadas automáticamente por Railway al conectar los plugins
DB_HOST                = ${{Postgres.PGHOST}}
DB_PORT                = ${{Postgres.PGPORT}}
DB_USERNAME            = ${{Postgres.PGUSER}}
DB_PASSWORD            = ${{Postgres.PGPASSWORD}}
REDIS_HOST             = ${{Redis.REDISHOST}}
REDIS_PORT             = ${{Redis.REDISPORT}}
REDIS_PASSWORD         = ${{Redis.REDISPASSWORD}}

# Secrets — diferente por entorno
JWT_SECRET             = <openssl rand -base64 32>
JWT_REFRESH_SECRET     = <openssl rand -base64 32>
INTERNAL_TOKEN         = <openssl rand -base64 32>
```

**user-service:**

```text
PORT                   = 3001
DB_NAME                = user_db
NODE_ENV               = production

DB_HOST                = ${{Postgres.PGHOST}}
DB_PORT                = ${{Postgres.PGPORT}}
DB_USERNAME            = ${{Postgres.PGUSER}}
DB_PASSWORD            = ${{Postgres.PGPASSWORD}}

INTERNAL_TOKEN         = <mismo valor que auth-service en el mismo entorno>
AUTH_SERVICE_URL       = http://auth-service.railway.internal:3000
```

> **Regla de oro de los secrets:**
> `JWT_SECRET` de dev ≠ `JWT_SECRET` de test ≠ `JWT_SECRET` de prod.
> Un token de dev nunca debe ser válido en prod.

### Paso 5 — Desplegar api-docs (documentación)

```text
DOCS_USER     = sgd          # usuario para basic auth (por defecto: sgd)
DOCS_PASSWORD = <password>   # password para acceder a la documentación
```

La documentación queda disponible en la URL pública del servicio en Railway.

### Paso 6 — URLs públicas por entorno

```
Entorno   URL generada por Railway
───────────────────────────────────────────────────────────
dev       https://api-gateway-dev-xxxx.up.railway.app
test      https://api-gateway-test-xxxx.up.railway.app
prod      https://api-gateway-prod-xxxx.up.railway.app
```

### Paso 7 — Railway CLI (flujo diario)

```bash
npm install -g @railway/cli
railway login
railway link

# Ver variables del entorno dev
railway variables --environment dev

# Ver logs del auth-service en dev
railway logs --service auth-service --environment dev
```

### Generar secrets seguros

```bash
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

# Verificar rutas de Kong
curl http://localhost:8001/routes

# Reiniciar un pod tras actualizar la imagen
# Nota: api-gateway usa strategy: Recreate (hostPort) — eliminar el pod manualmente si el rollout queda pendiente
kubectl rollout restart deployment/<nombre> -n gestor-documental
kubectl delete pod -n gestor-documental -l app=api-gateway   # solo si el rollout de Kong se bloquea

# Parar toda la infraestructura local
docker compose down
kind delete cluster --name sgd-local

# Migraciones (requiere Docker Compose corriendo)
cd services/user-service
npm run migration:run

cd services/auth-service
npm run migration:run
```
