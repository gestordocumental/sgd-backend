# Sistema de Gestión Documental — Backend

Plataforma de gestión documental multi-tenant basada en microservicios.
Desplegada en Railway (dev / test / prod). Localmente se ejecuta con Docker Compose + `npm run start:dev`.

---

## Arquitectura

```
Frontend
    │
    ▼
Kong API Gateway  (:8000 local / HTTPS en Railway)
    │  ← verifica JWT · genera x-correlation-id · aplica rate limiting · CORS
    │
    ├── /api/auth/*              → auth-service          :3000  (PostgreSQL + Redis)
    ├── /api/users/*             → user-service          :3001  (PostgreSQL + Redis + Kafka)
    ├── /api/roles/*             → user-service          :3001
    ├── /api/permissions/*       → user-service          :3001
    ├── /api/org/*               → org-service           :3002  (PostgreSQL)
    ├── /api/documents/*         → document-service      :3003  (MongoDB + MinIO + Kafka)
    ├── /api/workflows/*         → workflow-service      :3005  (pendiente)
    ├── /api/notifications/*     → notification-service  :3006  (pendiente)
    └── /api/audit/*             → audit-service         :3007  (Elasticsearch, pendiente)

Mensajería asíncrona (Kafka):
  document-service  ──[typology.file.uploaded]──►  metadata-extractor-service  :3004
  metadata-extractor-service  ──[typology.metadata.extracted]──►  document-service
  user-service  ──[user.invited]──►  notification-service (pendiente)
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + NestJS 10 |
| API Gateway | Kong 3.4 (DB-less, declarativo) |
| Auth | JWT HS256 · rotación atómica de refresh token (Redis GETDEL) |
| BD relacional | PostgreSQL 15 (auth, user, org) |
| BD documental | MongoDB 7 (document-service) |
| Caché / sesiones | Redis 7 |
| Mensajería | Apache Kafka (KRaft, sin Zookeeper) |
| Object storage | MinIO / Cloudflare R2 (S3-compatible) |
| Búsqueda / auditoría | Elasticsearch 8 |
| Documentación API | Swagger / OpenAPI 3 (`@nestjs/swagger`) |
| Trazabilidad | `x-correlation-id` propagado por Kong a todos los servicios |
| Despliegue | Railway (PaaS) — 3 entornos: dev, test, prod |

---

## Estructura del proyecto

```
document-management-system/
│
├── docker-compose.yml            # Infraestructura local completa
├── .env.example                  # Variables para docker-compose (KONG_JWT_SECRET)
│
├── docker/
│   ├── kong/
│   │   └── kong.local.yaml       # Configuración Kong para local (DB-less)
│   └── postgres-init/
│       └── init-databases.sh     # Crea DBs y usuarios al iniciar PostgreSQL
│
├── railway/
│   ├── api-gateway/
│   │   ├── kong.yaml             # Configuración Kong con DNS interno de Railway
│   │   ├── Dockerfile            # Imagen Kong (usuario no-root, puerto 8080)
│   │   ├── entrypoint.sh         # Sustituye env vars en kong.yaml al arrancar
│   │   └── railway.json
│   └── api-docs/
│       ├── Dockerfile            # Nginx con basic auth
│       ├── nginx.conf
│       ├── entrypoint.sh         # Genera .htpasswd en runtime
│       ├── railway.json
│       └── public/               # HTML estático de documentación
│
└── services/
    ├── auth-service/             # Autenticación global, JWT, credenciales
    ├── user-service/             # Usuarios, roles, permisos RBAC, invitaciones
    ├── org-service/              # Organizaciones, estructura (depts / áreas / cargos)
    ├── document-service/         # Tipologías, carga de archivos, extracción de metadata
    └── metadata-extractor-service/ # Worker Kafka: extrae metadata de PDF/DOCX
```

Cada servicio tiene la misma estructura interna:

```
services/<nombre>/
├── Dockerfile
├── package.json
├── .env.example              # Variables requeridas documentadas
├── src/
│   ├── main.ts               # Bootstrap + Swagger setup
│   ├── app.module.ts
│   ├── <dominio>/            # Controllers, services, DTOs, entities/schemas
│   ├── common/
│   │   ├── guards/           # JwtGuard (verifica firma HMAC-SHA256)
│   │   ├── decorators/       # @OrgMember(), @RequireSuperAdmin(), @JwtPayload()
│   │   ├── filters/          # HttpExceptionFilter global
│   │   ├── interceptors/     # LoggingInterceptor
│   │   ├── middleware/       # CorrelationMiddleware (x-correlation-id)
│   │   ├── logger/           # AppLogger (Winston + AsyncLocalStorage)
│   │   └── kafka/            # KafkaProducerService / KafkaConsumerService
│   └── health/               # TerminusModule (/health)
└── migrations/               # Migraciones TypeORM (solo servicios con PostgreSQL)
```

---

## Microservicios

### auth-service · :3000

Gestiona la identidad global: credenciales (email + hash), generación y verificación de JWT, rotación de refresh tokens.

**Flujo de autenticación:**

```
1. POST /api/auth/login          → token global { sub, email }  (sin companyId)
2. GET  /api/auth/me/companies   → lista de orgs del usuario
3. POST /api/auth/switch-company → token scoped { sub, email, companyId }
4. POST /api/auth/refresh        → rota el par de tokens (GETDEL atómico en Redis)
```

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | — | Login global |
| POST | `/api/auth/refresh` | — | Rotar refresh token |
| GET | `/api/auth/me` | JWT | Identidad del usuario |
| GET | `/api/auth/me/companies` | JWT | Orgs del usuario |
| POST | `/api/auth/switch-company` | JWT | Token con contexto de org |
| POST | `/api/auth/credentials/provision` | `x-internal-token` | Crear credenciales (interno) |
| PATCH | `/api/auth/credentials/:userId/disable` | `x-internal-token` | Deshabilitar credenciales |
| PATCH | `/api/auth/credentials/:userId/enable` | `x-internal-token` | Habilitar credenciales |

---

### user-service · :3001

CRUD de usuarios con soft delete. Flujo de invitación (token de un uso con TTL 72h en Redis). RBAC con roles de sistema y roles custom por org.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/users` | JWT | Crear usuario + enviar invitación |
| GET | `/api/users` | JWT | Listar usuarios |
| GET | `/api/users/:id` | JWT | Obtener usuario |
| PATCH | `/api/users/:id` | JWT | Actualizar perfil |
| DELETE | `/api/users/:id` | JWT | Soft delete |
| POST | `/api/users/:id/restore` | JWT | Restaurar usuario |
| POST | `/api/users/complete-registration` | — | Completar registro (token invitación) |
| PATCH | `/api/users/:id/super-admin` | JWT (super admin) | Promover / revocar super admin |
| POST | `/api/users/:id/orgs` | JWT | Asignar usuario a org con rol |
| DELETE | `/api/users/:id/orgs/:orgId` | JWT | Quitar usuario de org |
| GET | `/api/roles` | JWT | Listar roles |
| POST | `/api/roles` | JWT | Crear rol custom |
| POST | `/api/roles/:id/permissions` | JWT | Asignar permisos a rol |
| GET | `/api/permissions` | JWT | Catálogo de permisos |

**Módulos de permisos:** `DOCUMENTS`, `WORKFLOWS`, `USERS`, `ORGS`, `AUDIT`, `PLATFORM`
**Acciones:** `READ`, `WRITE`, `DELETE`, `APPROVE`, `UPLOAD`, `DOWNLOAD`, `MANAGE`

---

### org-service · :3002

Gestión de organizaciones y su estructura jerárquica: departamentos → áreas → cargos. Endpoint interno para resolver nombres de estructura en IDs (usado por bulk import de document-service).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/org` | JWT (super admin) | Crear organización |
| GET | `/api/org` | JWT (super admin) | Listar todas las orgs |
| GET | `/api/org/:id` | JWT | Obtener org |
| PATCH | `/api/org/:id` | JWT | Actualizar org |
| DELETE | `/api/org/:id` | JWT (super admin) | Soft delete org |
| POST | `/api/org/:orgId/departamentos` | JWT | Crear departamento |
| POST | `/api/org/:orgId/departamentos/:deptId/areas` | JWT | Crear área |
| POST | `/api/org/:orgId/areas/:areaId/cargos` | JWT | Crear cargo |
| POST | `/api/org/:orgId/structure/bulk` | JWT | Importar estructura desde Excel |

---

### document-service · :3003

Gestión de tipologías documentales. Carga de archivos (PDF/DOCX/DOC) al object storage. Importación masiva desde Excel. Orquesta la extracción de metadata via Kafka.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/documents/:orgId/typologies` | JWT | Crear tipología |
| GET | `/api/documents/:orgId/typologies` | JWT | Listar (paginado) |
| GET | `/api/documents/:orgId/typologies/:id` | JWT | Obtener tipología |
| PATCH | `/api/documents/:orgId/typologies/:id` | JWT | Actualizar |
| DELETE | `/api/documents/:orgId/typologies/:id` | JWT | Soft delete |
| POST | `/api/documents/:orgId/typologies/:id/file` | JWT | Subir archivo (máx 20 MB) |
| GET | `/api/documents/:orgId/typologies/:id/file` | JWT | URL firmada de descarga (5 min) |
| PATCH | `/api/documents/:orgId/typologies/:id/resolve-extraction` | JWT | Confirmar / resolver metadata extraída |
| POST | `/api/documents/:orgId/typologies/bulk` | JWT | Importar tipologías desde Excel (máx 500 filas) |

**Flujo de extracción de metadata:**

```
1. Subir archivo  →  estado: PROCESSING
2. Kafka: typology.file.uploaded  →  metadata-extractor-service lo consume
3a. Éxito  →  Kafka: typology.metadata.extracted
      Si tiene datos declarados: compara → COMPLETED o DISCREPANCY
      Si no tiene datos: propone valores → PENDING_CONFIRMATION
3b. Fallo  →  Kafka: typology.metadata.extraction.failed  →  estado: FAILED
4. Usuario resuelve discrepancia o confirma  →  estado: CONFIRMED
```

---

### metadata-extractor-service · :3004

Worker sin endpoints públicos. Consume `typology.file.uploaded`, descarga el archivo del object storage, extrae metadata (nombre, código, versión) de PDF y DOCX, y publica el resultado en Kafka.

---

## Documentación Swagger

Cada servicio expone su documentación interactiva en `/api/<servicio>/docs`.

| Servicio | URL local (directo) | URL local (Kong) |
|---|---|---|
| auth-service | http://localhost:3000/api/auth/docs | http://localhost:8000/api/auth/docs |
| user-service | http://localhost:3001/api/users/docs | http://localhost:8000/api/users/docs |
| org-service | http://localhost:3002/api/org/docs | http://localhost:8000/api/org/docs |
| document-service | http://localhost:3003/api/documents/docs | http://localhost:8000/api/documents/docs |
| metadata-extractor | http://localhost:3004/api/metadata-extractor/docs | http://localhost:8000/api/metadata-extractor/docs |

> En **local** las rutas `/docs` son públicas (sin JWT). En **Railway (producción)** requieren JWT — acceder a la URL del api-gateway con el token en la cabecera `Authorization`.

---

## Infraestructura local (Docker Compose)

| Contenedor | Imagen | Puerto(s) | Propósito |
|---|---|---|---|
| `sgd-postgresql` | postgres:15-alpine | 5432 | BD relacional para auth, user, org |
| `sgd-mongodb` | mongo:7.0 | 27017 | BD documental para document-service |
| `sgd-redis` | redis:7.2-alpine | 6379 | Refresh tokens, tokens de invitación |
| `sgd-kafka` | apache/kafka:latest | 9094 (externo) | Mensajería (KRaft, sin Zookeeper) |
| `sgd-kafka-init` | apache/kafka:latest | — | Crea los tópicos al arrancar (una vez) |
| `sgd-kafka-ui` | provectuslabs/kafka-ui | 8090 | Panel visual de Kafka |
| `sgd-minio` | minio/minio:latest | 9000 · 9001 | Object storage (consola web en :9001) |
| `sgd-minio-init` | minio/mc:latest | — | Crea el bucket `documentos` (una vez) |
| `sgd-kong` | kong:3.4 | 8000 · 8101 | API Gateway (proxy · admin API) |
| `sgd-elasticsearch` | elasticsearch:8.11.0 | 9200 | Motor de búsqueda / auditoría |

**Tópicos Kafka creados:**

| Tópico | Particiones | Productor → Consumidor |
|---|---|---|
| `typology.file.uploaded` | 3 | document-service → metadata-extractor |
| `typology.metadata.extracted` | 3 | metadata-extractor → document-service |
| `typology.metadata.extraction.failed` | 3 | metadata-extractor → document-service |
| `user.invited` | 1 | user-service → notification (pendiente) |
| `notification.send` | 2 | varios → notification-service |
| `audit.log` | 3 | varios → audit-service |
| `document.created/approved/rejected` | 3 | document/workflow → audit, notification |
| `workflow.step.completed` | 3 | workflow → audit, notification |
| `service.health.event` | 1 | todos los servicios |

---

## Ejecución en local

### Prerrequisitos

| Herramienta | Versión mínima |
|---|---|
| Docker Desktop | 20+ |
| Node.js | 20+ |
| Git | cualquiera |

---

### Paso 1 — Clonar el repositorio

```bash
git clone <url-del-repo>
cd document-management-system
```

---

### Paso 2 — Variables de entorno de docker-compose

```bash
cp .env.example .env
# El valor por defecto funciona en local:
# KONG_JWT_SECRET=local-jwt-secret-change-me
```

> `KONG_JWT_SECRET` debe ser idéntico al `JWT_SECRET` de auth-service.

---

### Paso 3 — Levantar la infraestructura

```bash
docker compose up -d

# Esperar ~60 segundos y verificar que todo esté healthy
docker compose ps
```

Si es la primera vez (o si recreaste el contenedor de Kafka):

```bash
docker compose up kafka-init
```

---

### Paso 4 — Configurar y arrancar cada microservicio

Abrir una terminal por servicio:

```bash
# Terminal 1 — auth-service
cd services/auth-service
cp .env.example .env   # editar con valores locales
npm install
npm run start:dev

# Terminal 2 — user-service
cd services/user-service
cp .env.example .env
npm install
npm run start:dev

# Terminal 3 — org-service
cd services/org-service
cp .env.example .env
npm install
npm run start:dev

# Terminal 4 — document-service
cd services/document-service
cp .env.example .env
npm install
npm run start:dev

# Terminal 5 — metadata-extractor-service
cd services/metadata-extractor-service
cp .env.example .env
npm install
npm run start:dev
```

---

### Paso 5 — Verificar que todo está en pie

| Servicio | URL de health |
|---|---|
| Kong proxy | http://localhost:8000/health |
| Kong admin | http://localhost:8101/status |
| auth-service | http://localhost:3000/health |
| user-service | http://localhost:3001/health |
| org-service | http://localhost:3002/health |
| document-service | http://localhost:3003/health |
| metadata-extractor | http://localhost:3004/health |
| Kafka UI | http://localhost:8090 |
| MinIO console | http://localhost:9001 (admin: `minio_admin` / `minio_secret_local`) |

---

### Variables de entorno requeridas por servicio

Cada `.env.example` está completamente documentado. Los valores para local son:

#### Comunes a todos los servicios

```env
NODE_ENV=development
INTERNAL_TOKEN=internal-token-local-dev-change-in-prod
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

#### auth-service

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db
DB_USERNAME=postgres
DB_PASSWORD=postgres_local
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
JWT_REFRESH_SECRET=sgd-refresh-secret-local-dev-change-in-prod
JWT_EXPIRATION=3600s
JWT_REFRESH_EXPIRATION=12h
USER_SERVICE_URL=http://localhost:3001
```

#### user-service

```env
PORT=3001
DB_HOST=localhost  DB_PORT=5432  DB_NAME=user_db
DB_USERNAME=postgres  DB_PASSWORD=postgres_local
REDIS_HOST=localhost  REDIS_PORT=6379
AUTH_SERVICE_URL=http://localhost:3000
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

#### org-service

```env
PORT=3002
DB_HOST=localhost  DB_PORT=5432  DB_NAME=org_db
DB_USERNAME=postgres  DB_PASSWORD=postgres_local
USER_SERVICE_URL=http://localhost:3001
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

#### document-service

```env
PORT=3003
MONGODB_URI=mongodb://mongo_admin:mongo_pass_local@localhost:27017/document_db?authSource=admin
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minio_admin
STORAGE_SECRET_KEY=minio_secret_local
STORAGE_BUCKET=documentos
STORAGE_FORCE_PATH=true
SIGNED_URL_EXPIRY=300
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=document-service
KAFKA_CONSUMER_GROUP=document-service-group
ORG_SERVICE_URL=http://localhost:3002
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

#### metadata-extractor-service

```env
PORT=3004
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minio_admin
STORAGE_SECRET_KEY=minio_secret_local
STORAGE_BUCKET=documentos
STORAGE_FORCE_PATH=true
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=metadata-extractor-service
KAFKA_CONSUMER_GROUP=metadata-extractor-group
```

---

## Consumir la API

Todos los endpoints pasan por Kong en `http://localhost:8000`.

### Flujo básico

```bash
# 1. Login
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}'
# → { "accessToken": "eyJ...", "refreshToken": "eyJ..." }

# 2. Obtener orgs del usuario
curl http://localhost:8000/api/auth/me/companies \
  -H "Authorization: Bearer <accessToken>"

# 3. Cambiar contexto a una org
curl -X POST http://localhost:8000/api/auth/switch-company \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"companyId":"<orgId>"}'
# → { "accessToken": "eyJ..." }  ← token con companyId

# 4. Usar el token scoped para endpoints de org
curl http://localhost:8000/api/documents/<orgId>/typologies \
  -H "Authorization: Bearer <tokenScoped>"
```

### Probar con Swagger

1. Abrir http://localhost:8000/api/auth/docs
2. Ejecutar `POST /api/auth/login`
3. Copiar `accessToken` → clic en **Authorize** → pegar el token
4. Ya se puede ejecutar cualquier endpoint protegido directamente desde el UI

---

## Modelo de usuarios y roles

### Identidad global (auth-service)

Un usuario tiene **una única credencial global** (email + password). La pertenencia a organizaciones se gestiona por roles, no en las credenciales.

### Jerarquía de roles

| Rol | Scope | Modificable |
|---|---|---|
| `SUPER_ADMIN` | Sistema | No |
| `ADMIN` | Sistema | No |
| `MANAGER` | Sistema | No |
| `EDITOR` | Sistema | No |
| `VIEWER` | Sistema | No |
| Roles custom | Org específica | Sí (si no tiene usuarios asignados) |

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

## Seguridad

| Área | Mecanismo |
|---|---|
| Verificación JWT | HMAC-SHA256 verificado en cada guard (defensa en profundidad independiente de Kong) |
| Rotación de refresh token | `GETDEL` atómico en Redis — previene replay con requests concurrentes |
| Token interno entre servicios | `timingSafeEqual` (previene timing attacks) |
| Login timing-safe | `bcrypt.compare` siempre corre aunque el usuario no exista (previene enumeración) |
| Validación de mensajes Kafka | Validación de esquema + `ObjectId.isValid()` antes de procesar cualquier mensaje |
| Rate limiting en login | 10 req/min en `/api/auth/login` y `/api/auth/refresh` |
| Swagger en producción | Rutas `/docs` protegidas con JWT en Railway |
| Subida de archivos | Validación de MIME type + límite de 20 MB |
| Trazabilidad | `x-correlation-id` propagado por Kong a todos los microservicios |

---

## Trazabilidad distribuida

Kong genera un `x-correlation-id` (UUID) por cada request y lo propaga como header. Cada servicio:

1. Lee el header en `CorrelationMiddleware` (genera uno propio si no viene)
2. Lo almacena en `AsyncLocalStorage` durante el ciclo de vida del request
3. Lo incluye en cada línea de log via `AppLogger`
4. Lo devuelve en la respuesta HTTP

Esto permite filtrar los logs de una request completa en todos los servicios con un único ID.

---

## Migraciones de base de datos

Los servicios con TypeORM (auth, user, org) tienen el CLI configurado:

```bash
# Generar migración desde cambios en entidades
npm run migration:generate -- src/migrations/NombreMigracion

# Aplicar migraciones pendientes
npm run migration:run

# Revertir la última migración
npm run migration:revert

# Ver estado
npm run migration:show
```

> En `NODE_ENV=development` TypeORM usa `synchronize: true` para iterar rápido.
> En cualquier otro entorno las migraciones son obligatorias.

El catálogo de permisos **no requiere migraciones** — se siembra automáticamente en cada arranque desde `permissions.seeder.ts`.

---

## Despliegue en Railway

Railway es un PaaS: no usa Kubernetes. Cada microservicio es un servicio independiente con su propio `Dockerfile` y `railway.json`.

### Estrategia de ramas → entornos

```
Rama git     Entorno Railway   NODE_ENV
────────────────────────────────────────
develop  →   dev               development
test     →   test              test
main     →   prod              production
```

### Diferencias local vs Railway

| Aspecto | Local | Railway |
|---|---|---|
| Orquestación | Docker Compose + `npm run start:dev` | Railway PaaS |
| DNS interno | `localhost` | `<servicio>.railway.internal:3000` |
| Infraestructura | Docker Compose | Plugins nativos + servicios Docker |
| Kong config | `docker/kong/kong.local.yaml` | `railway/api-gateway/kong.yaml` |
| Secrets | `.env` local | Variables de entorno en dashboard |
| Kong puerto | 8000 | 8080 (interno Railway) |

### Variables de entorno en Railway

Los secrets **nunca** se almacenan en el repositorio. Se configuran por entorno en el dashboard o vía Railway CLI.

```bash
# Generar secrets seguros
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # JWT_REFRESH_SECRET
openssl rand -base64 32   # INTERNAL_TOKEN
```

> **Regla de oro:** `JWT_SECRET` de dev ≠ test ≠ prod.
> `JWT_SECRET` debe ser **igual** en auth-service, user-service, org-service y document-service dentro del mismo entorno.
> `KONG_JWT_SECRET` debe ser **igual** al `JWT_SECRET` de auth-service.

### Variables Railway — auth-service (ejemplo)

```
PORT=3000
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 32>
JWT_REFRESH_SECRET=<openssl rand -base64 32>
JWT_EXPIRATION=3600s
JWT_REFRESH_EXPIRATION=12h
INTERNAL_TOKEN=<openssl rand -base64 32>
DB_NAME=auth_db
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_USERNAME=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
REDIS_HOST=${{Redis.REDISHOST}}
REDIS_PORT=${{Redis.REDISPORT}}
REDIS_PASSWORD=${{Redis.REDISPASSWORD}}
USER_SERVICE_URL=http://user-service.railway.internal:3000
```

### Railway CLI

```bash
npm install -g @railway/cli
railway login
railway link

# Ver variables del entorno dev
railway variables --environment dev

# Ver logs de un servicio
railway logs --service auth-service --environment dev
```

---

## Comandos útiles

```bash
# Levantar toda la infraestructura local
docker compose up -d

# Parar la infraestructura
docker compose down

# Ver logs de un contenedor
docker compose logs -f kafka

# Recrear Kafka con volumen limpio (si hay estado corrupto)
docker compose down kafka
docker volume rm sgd-infra_kafkadata
docker compose up -d kafka
docker compose up kafka-init

# Verificar rutas de Kong (admin API local)
curl http://localhost:8101/routes

# Ver tópicos de Kafka
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --list

# Ver consumer groups
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --list

# Migraciones (requiere PostgreSQL corriendo)
cd services/auth-service && npm run migration:run
cd services/user-service && npm run migration:run
cd services/org-service  && npm run migration:run
```
