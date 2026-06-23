# Sistema de Gestión Documental — Backend

Plataforma de gestión documental multi-tenant basada en microservicios.
Desplegada en Railway (dev / test / prod). Localmente se ejecuta con Docker Compose + `npm run start:dev`.

---

## Arquitectura

```text
Frontend
    │
    ▼
Kong API Gateway  (:8000 local / HTTPS en Railway)
    │  ← verifica JWT · genera x-correlation-id · aplica rate limiting · CORS
    │
    ├── /api/v1/auth/*              → auth-service          :3000  (PostgreSQL + Redis)
    ├── /api/v1/users/*             → user-service          :3001  (PostgreSQL + Redis + Kafka)
    ├── /api/v1/roles/*             → user-service          :3001
    ├── /api/v1/permissions/*       → user-service          :3001
    ├── /api/v1/org/*               → org-service           :3002  (PostgreSQL)
    ├── /api/v1/documents/*         → document-service      :3003  (MongoDB + R2/MinIO + Kafka)
    ├── /api/v1/workflows/*         → workflow-service      :3005  (PostgreSQL + Kafka)
    ├── /api/v1/notifications/*     → notification-service  :3006  (PostgreSQL + Redis + Kafka)
    └── /api/v1/audit/*             → audit-service         :3007  (Elasticsearch + Kafka)

Mensajería asíncrona (Kafka):
  user-service          ──[user.invited]──────────────────►  notification-service
  document-service      ──[typology.file.uploaded]─────────►  metadata-extractor-service  :3004
  metadata-extractor    ──[typology.metadata.*]─────────────►  document-service
  workflow-service      ──[workflow.*]──────────────────────►  audit-service
  workflow-service      ──[notification.send]───────────────►  notification-service
  notification-service  ──[SSE stream]──────────────────────►  Frontend (EventSource)
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + NestJS 10 |
| API Gateway | Kong 3.4 (DB-less, declarativo) |
| Auth | JWT HS256 · rotación de kid · rotación atómica de refresh token (Redis GETDEL) |
| BD relacional | PostgreSQL 15 (auth, user, org, workflow, notification) |
| BD documental | MongoDB 7 (document-service) |
| Caché / sesiones | Redis 7 |
| Mensajería | Apache Kafka (KRaft, sin Zookeeper) |
| Object storage | MinIO (local) / Cloudflare R2 (Railway) — S3-compatible |
| Auditoría | Elasticsearch 8 (audit-service) |
| Documentación API | Swagger / OpenAPI 3 (`@nestjs/swagger`) |
| Trazabilidad | `x-correlation-id` propagado por Kong a todos los servicios |
| Despliegue | Railway (PaaS) — 3 entornos: dev, test, prod |
| Emails transaccionales | Resend API (password reset, invitaciones, notificaciones) |

---

## Estructura del proyecto

```text
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
├── tests/
│   └── performance/
│       ├── stress-test.js                    # Prueba de carga — operaciones de lectura (400 VUs)
│       └── workflow-creation-stress-test.js  # Prueba de carga — creación de workflows (100 VUs)
│
└── services/
    ├── auth-service/             # Autenticación global, JWT, credenciales
    ├── user-service/             # Usuarios, roles, permisos RBAC, invitaciones
    ├── org-service/              # Organizaciones, estructura (depts / áreas / cargos)
    ├── document-service/         # Tipologías, carga de archivos, extracción de metadata
    ├── metadata-extractor-service/ # Worker Kafka: extrae metadata de PDF/DOCX
    ├── workflow-service/         # Flujos de aprobación y ciclos administrativos
    ├── notification-service/     # Notificaciones en tiempo real (SSE) y por email
    └── audit-service/            # Registro de auditoría (Elasticsearch)
```

Cada servicio tiene la misma estructura interna:

```text
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
│   │   ├── decorators/       # @OrgMember(), @SuperAdminOnly(), @JwtPayloadParam()
│   │   ├── filters/          # HttpExceptionFilter global
│   │   ├── interceptors/     # LoggingInterceptor
│   │   ├── middleware/       # CorrelationMiddleware (x-correlation-id)
│   │   ├── logger/           # AppLogger (Winston + AsyncLocalStorage)
│   │   └── kafka/            # KafkaProducerService / runWithCorrelation() / withDlt()
│   └── health/               # TerminusModule (/health)
└── migrations/               # Migraciones TypeORM (solo servicios con PostgreSQL)
```

---

## Microservicios

### auth-service · :3000

Gestiona la identidad global: credenciales (email + hash bcrypt), generación y verificación de JWT, rotación de refresh tokens, recuperación de contraseña.

**Flujo de autenticación:**

```text
1. POST /api/v1/auth/login          → token global { sub, email }  (sin companyId)
2. GET  /api/v1/auth/me/companies   → lista de orgs del usuario
3. POST /api/v1/auth/switch-company → token scoped { sub, email, companyId }
4. POST /api/v1/auth/refresh        → rota el par de tokens (GETDEL atómico en Redis)
5. POST /api/v1/auth/exit-company   → token global (descarta companyId)
```

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/auth/login` | — | Login global |
| POST | `/api/v1/auth/refresh` | — | Rotar refresh token |
| POST | `/api/v1/auth/forgot-password` | — | Solicitar restablecimiento de contraseña |
| POST | `/api/v1/auth/reset-password` | — | Restablecer contraseña con token |
| GET | `/api/v1/auth/me` | JWT | Identidad del usuario |
| GET | `/api/v1/auth/me/companies` | JWT | Orgs del usuario |
| POST | `/api/v1/auth/switch-company` | JWT | Token con contexto de org |
| POST | `/api/v1/auth/exit-company` | JWT | Descartar contexto de org |
| POST | `/api/v1/auth/credentials/provision` | `x-internal-token` | Crear / resetear credenciales (interno) |
| PATCH | `/api/v1/auth/credentials/:userId/disable` | `x-internal-token` | Deshabilitar credenciales |
| PATCH | `/api/v1/auth/credentials/:userId/enable` | `x-internal-token` | Habilitar credenciales |

---

### user-service · :3001

CRUD de usuarios con soft delete. Flujo de invitación por email (token de un uso con TTL 72h en Redis). RBAC con roles de sistema y roles custom por org.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/users` | JWT | Crear usuario + enviar invitación |
| GET | `/api/v1/users` | JWT | Listar usuarios |
| GET | `/api/v1/users/:id` | JWT | Obtener usuario |
| PATCH | `/api/v1/users/:id` | JWT | Actualizar perfil |
| DELETE | `/api/v1/users/:id` | JWT | Soft delete |
| POST | `/api/v1/users/:id/restore` | JWT | Restaurar usuario eliminado |
| PATCH | `/api/v1/users/:id/disable` | JWT | Deshabilitar acceso |
| PATCH | `/api/v1/users/:id/enable` | JWT | Habilitar acceso |
| POST | `/api/v1/users/:id/provision` | JWT | Asignar contraseña directamente (admin) |
| POST | `/api/v1/users/complete-registration` | — | Completar registro con token de invitación |
| PATCH | `/api/v1/users/:id/super-admin` | JWT (super admin) | Promover / revocar super admin |
| POST | `/api/v1/users/:id/orgs` | JWT | Asignar usuario a org con rol |
| DELETE | `/api/v1/users/:id/orgs/:orgId` | JWT | Quitar usuario de org |
| GET | `/api/v1/roles` | JWT | Listar roles |
| POST | `/api/v1/roles` | JWT | Crear rol custom |
| POST | `/api/v1/roles/:id/permissions` | JWT | Asignar permisos a rol |
| GET | `/api/v1/permissions` | JWT | Catálogo de permisos |

**Módulos de permisos:** `DOCUMENTS`, `WORKFLOWS`, `USERS`, `ORGS`, `AUDIT`, `PLATFORM`
**Acciones:** `READ`, `WRITE`, `DELETE`, `APPROVE`, `UPLOAD`, `DOWNLOAD`, `MANAGE`

---

### org-service · :3002

Gestión de organizaciones y su estructura jerárquica: departamentos → áreas → cargos. Endpoint interno para resolver nombres de estructura en IDs (usado por bulk import de document-service).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/org` | JWT (super admin) | Crear organización |
| GET | `/api/v1/org` | JWT (super admin) | Listar todas las orgs |
| GET | `/api/v1/org/mine` | JWT | Obtener org del usuario autenticado |
| GET | `/api/v1/org/:id` | JWT | Obtener org por ID |
| PATCH | `/api/v1/org/:id` | JWT | Actualizar org |
| DELETE | `/api/v1/org/:id` | JWT (super admin) | Soft delete org |
| POST | `/api/v1/org/:orgId/departamentos` | JWT | Crear departamento |
| POST | `/api/v1/org/:orgId/departamentos/:deptId/areas` | JWT | Crear área |
| POST | `/api/v1/org/:orgId/areas/:areaId/cargos` | JWT | Crear cargo |
| POST | `/api/v1/org/:orgId/structure/bulk` | JWT | Importar estructura desde Excel |

---

### document-service · :3003

Gestión de tipologías documentales. Carga de archivos (PDF/DOCX/DOC) al object storage. Importación masiva desde Excel. Orquesta la extracción de metadata vía Kafka.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/documents/:orgId/typologies` | JWT | Crear tipología |
| GET | `/api/v1/documents/:orgId/typologies` | JWT | Listar (paginado) |
| GET | `/api/v1/documents/:orgId/typologies/:id` | JWT | Obtener tipología |
| PATCH | `/api/v1/documents/:orgId/typologies/:id` | JWT | Actualizar |
| DELETE | `/api/v1/documents/:orgId/typologies/:id` | JWT | Soft delete |
| POST | `/api/v1/documents/:orgId/typologies/:id/file` | JWT | Subir archivo (máx 20 MB) |
| GET | `/api/v1/documents/:orgId/typologies/:id/file` | JWT | URL firmada de descarga (5 min) |
| PATCH | `/api/v1/documents/:orgId/typologies/:id/resolve-extraction` | JWT | Confirmar / resolver metadata extraída |
| POST | `/api/v1/documents/:orgId/typologies/bulk` | JWT | Importar tipologías desde Excel (máx 500 filas) |

**Flujo de extracción de metadata:**

```text
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

### workflow-service · :3005

Gestión de flujos de aprobación de documentos y ciclos administrativos. Mantiene un timeline de eventos por workflow. Se comunica con document-service (validación de tipología) y user-service (resolución de usuarios) vía HTTP interno.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/workflows` | JWT | Crear workflow en borrador |
| GET | `/api/v1/workflows` | JWT | Listar workflows |
| GET | `/api/v1/workflows/stats` | JWT | Estadísticas de workflows |
| GET | `/api/v1/workflows/my-tasks` | JWT | Tareas de aprobación pendientes del usuario |
| GET | `/api/v1/workflows/my-available` | JWT | Workflows disponibles para el usuario final |
| GET | `/api/v1/workflows/:id` | JWT | Obtener workflow |
| PATCH | `/api/v1/workflows/:id` | JWT | Actualizar workflow (solo en borrador) |
| DELETE | `/api/v1/workflows/:id` | JWT | Eliminar workflow |
| POST | `/api/v1/workflows/:id/start-approval` | JWT | Iniciar ciclo de aprobación |
| POST | `/api/v1/workflows/:id/approve` | JWT | Aprobar paso actual |
| POST | `/api/v1/workflows/:id/reject` | JWT | Rechazar paso actual |
| POST | `/api/v1/workflows/:id/admin-cycles` | JWT | Crear ciclo administrativo |
| PATCH | `/api/v1/workflows/:id/admin-cycles/:cycleId/steps/:stepId/complete` | JWT | Completar paso administrativo |
| POST | `/api/v1/workflows/:id/admin-cycles/:cycleId/steps/:stepId/forward` | JWT | Reenviar paso administrativo |
| POST | `/api/v1/workflows/:id/admin-cycles/:cycleId/finalize` | JWT | Finalizar ciclo administrativo |
| POST | `/api/v1/workflows/:id/skip-review-cycle` | JWT | Omitir ciclo de revisión |
| POST | `/api/v1/workflows/:id/close` | JWT | Cerrar workflow |
| GET | `/api/v1/workflows/:id/timeline` | JWT | Historial de eventos del workflow |
| POST | `/api/v1/workflows/notify-no-final-users` | JWT | Notificar ausencia de usuarios finales |

---

### notification-service · :3006

Recibe eventos de Kafka (`notification.send`) y los convierte en notificaciones persistentes en PostgreSQL. Entrega notificaciones en tiempo real vía SSE (Server-Sent Events). Envía emails transaccionales a través de Resend API.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/notifications/stream/ticket` | JWT | Obtener ticket efímero para SSE (TTL 30s) |
| GET | `/api/v1/notifications/stream?ticket=<token>` | ticket | Stream SSE de notificaciones en tiempo real |
| GET | `/api/v1/notifications` | JWT | Listar notificaciones del usuario |
| GET | `/api/v1/notifications/unread-count` | JWT | Contador de notificaciones sin leer |
| PATCH | `/api/v1/notifications/read-all` | JWT | Marcar todas como leídas |
| PATCH | `/api/v1/notifications/:id/read` | JWT | Marcar una notificación como leída |

**Flujo SSE:**
```text
1. POST /stream/ticket (con JWT)  →  ticket efímero (30s)
2. GET /stream?ticket=<token>     →  conexión SSE larga (sin JWT en header — compatible con EventSource)
3. Kafka notification.send        →  notification-service procesa → escribe en DB → push SSE
```

---

### audit-service · :3007

Consume eventos de Kafka de todos los servicios y los indexa en Elasticsearch. Expone endpoints de consulta y exportación del log de auditoría.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/audit/logs` | JWT | Consultar logs de auditoría (paginado, filtrable) |
| GET | `/api/v1/audit/logs/export` | JWT | Exportar logs a Excel |
| GET | `/api/v1/audit/logs/:id` | JWT | Obtener log individual |

---

## Documentación Swagger

Cada servicio expone su documentación interactiva en `/api/v1/<servicio>/docs`.

| Servicio | URL local (directo) | URL local (Kong) |
|---|---|---|
| auth-service | http://localhost:3000/api/v1/auth/docs | http://localhost:8000/api/v1/auth/docs |
| user-service | http://localhost:3001/api/v1/users/docs | http://localhost:8000/api/v1/users/docs |
| org-service | http://localhost:3002/api/v1/org/docs | http://localhost:8000/api/v1/org/docs |
| document-service | http://localhost:3003/api/v1/documents/docs | http://localhost:8000/api/v1/documents/docs |
| metadata-extractor | — (worker sin endpoints públicos) | — |
| workflow-service | http://localhost:3005/api/v1/workflows/docs | http://localhost:8000/api/v1/workflows/docs |
| notification-service | http://localhost:3006/api/v1/notifications/docs | http://localhost:8000/api/v1/notifications/docs |
| audit-service | http://localhost:3007/api/v1/audit/docs | http://localhost:8000/api/v1/audit/docs |

> En **local** las rutas `/docs` son públicas (sin JWT). En **Railway (producción)** requieren JWT — acceder a la URL del api-gateway con el token en la cabecera `Authorization`.

---

## Infraestructura local (Docker Compose)

| Contenedor | Imagen | Puerto(s) | Propósito |
|---|---|---|---|
| `sgd-postgresql` | postgres:15-alpine | 5432 | BD relacional para auth, user, org, workflow, notification |
| `sgd-mongodb` | mongo:7.0 | 27017 | BD documental para document-service |
| `sgd-redis` | redis:7.2-alpine | 6379 | Refresh tokens, tokens de invitación, tickets SSE |
| `sgd-kafka` | apache/kafka:latest | 9094 (externo) | Mensajería (KRaft, sin Zookeeper) |
| `sgd-kafka-init` | apache/kafka:latest | — | Crea los tópicos al arrancar (una vez) |
| `sgd-kafka-ui` | provectuslabs/kafka-ui | 8090 | Panel visual de Kafka |
| `sgd-minio` | minio/minio:latest | 9000 · 9001 | Object storage (consola web en :9001) |
| `sgd-minio-init` | minio/mc:latest | — | Crea el bucket `documentos` (una vez) |
| `sgd-kong` | kong:3.4 | 8000 · 8101 | API Gateway (proxy · admin API) |
| `sgd-elasticsearch` | elasticsearch:8.11.0 | 9200 | Motor de auditoría |

**Tópicos Kafka:**

| Tópico | Productor → Consumidor |
|---|---|
| `typology.file.uploaded` | document-service → metadata-extractor-service |
| `typology.metadata.extracted` | metadata-extractor-service → document-service |
| `typology.metadata.extraction.failed` | metadata-extractor-service → document-service |
| `user.invited` | user-service → notification-service |
| `notification.send` | workflow-service, user-service → notification-service |
| `audit.log` | todos los servicios → audit-service |
| `workflow.created` | workflow-service → audit-service |
| `workflow.cancelled` | workflow-service → audit-service |
| `workflow.approval.started` | workflow-service → audit-service, notification-service |
| `workflow.approval.approved` | workflow-service → audit-service, notification-service |
| `workflow.approval.rejected` | workflow-service → audit-service, notification-service |
| `workflow.approval.completed` | workflow-service → audit-service |
| `workflow.admin.cycle.started` | workflow-service → audit-service, notification-service |
| `workflow.admin.cycle.step.completed` | workflow-service → audit-service, notification-service |
| `workflow.admin.cycle.completed` | workflow-service → audit-service, notification-service |
| `workflow.available.for.final.users` | workflow-service → notification-service |
| `workflow.closed` | workflow-service → audit-service, notification-service |
| `workflow.resubmitted` | workflow-service → audit-service |
| `auth.password-reset` | auth-service → notification-service |
| `user.org-removed` | user-service → notification-service |
| `user.super-admin-revoked` | user-service → notification-service |
| `user.permissions-changed` | user-service → *(emitido; sin consumidor activo)* |

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
npm ci   # instala dependencias de todos los workspaces (packages/* y services/*)
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
cd services/auth-service && cp .env.example .env && npm run start:dev

# Terminal 2 — user-service
cd services/user-service && cp .env.example .env && npm run start:dev

# Terminal 3 — org-service
cd services/org-service && cp .env.example .env && npm run start:dev

# Terminal 4 — document-service
cd services/document-service && cp .env.example .env && npm run start:dev

# Terminal 5 — metadata-extractor-service
cd services/metadata-extractor-service && cp .env.example .env && npm run start:dev

# Terminal 6 — workflow-service
cd services/workflow-service && cp .env.example .env && npm run start:dev

# Terminal 7 — notification-service
cd services/notification-service && cp .env.example .env && npm run start:dev

# Terminal 8 — audit-service
cd services/audit-service && cp .env.example .env && npm run start:dev
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
| workflow-service | http://localhost:3005/health |
| notification-service | http://localhost:3006/health |
| audit-service | http://localhost:3007/health |
| Kafka UI | http://localhost:8090 |
| MinIO console | http://localhost:9001 (admin: `minio_admin` / `minio_secret_local`) |

---

### Variables de entorno requeridas por servicio

Cada `.env.example` está completamente documentado. Los valores para local son:

#### Comunes a todos los servicios con JWT

```env
NODE_ENV=development
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

> Los tokens internos (`INTERNAL_TOKEN_*`) son por par (origen → destino) y varían por servicio.
> Consultar cada `.env.example` para la lista exacta.

#### auth-service

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auth_db
DB_USERNAME=auth_user
DB_PASSWORD=auth_pass_local
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_local_pass
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
JWT_SECRET_KID=v1
JWT_REFRESH_SECRET=sgd-refresh-secret-local-dev-change-in-prod
JWT_REFRESH_SECRET_KID=v1
JWT_EXPIRATION=3600s
JWT_REFRESH_EXPIRATION=7d
SUPER_ADMIN_EMAIL=admin@sgd.local
SUPER_ADMIN_PASSWORD=Admin1234!
INTERNAL_TOKEN_AUTH_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_USER_AUTH=internal-token-local-dev-change-in-prod
USER_SERVICE_URL=http://localhost:3001
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=auth-service
```

#### user-service

```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=user_db
DB_USERNAME=user_svc_user
DB_PASSWORD=user_pass_local
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_local_pass
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
SUPER_ADMIN_EMAIL=admin@sgd.local
INTERNAL_TOKEN_USER_AUTH=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_USER_ORG=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_AUTH_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_NOTIF_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_WORKFLOW_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_ORG_USER=internal-token-local-dev-change-in-prod
AUTH_SERVICE_URL=http://localhost:3000
ORG_SERVICE_URL=http://localhost:3002
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=user-service
```

#### org-service

```env
PORT=3002
DB_HOST=localhost
DB_PORT=5432
DB_NAME=org_db
DB_USERNAME=org_user
DB_PASSWORD=org_pass_local
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
INTERNAL_TOKEN_ORG_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_NOTIF_ORG=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_DOC_ORG=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_USER_ORG=internal-token-local-dev-change-in-prod
USER_SERVICE_URL=http://localhost:3001
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=org-service
```

#### document-service

```env
PORT=3003
MONGODB_URI=mongodb://mongo_admin:mongo_pass_local@localhost:27017/document_db?authSource=admin
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=minio_admin
STORAGE_SECRET_KEY=minio_secret_local
STORAGE_BUCKET=documentos
STORAGE_FORCE_PATH=true
SIGNED_URL_EXPIRY=300
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=document-service
KAFKA_CONSUMER_GROUP=document-service-group
ORG_SERVICE_URL=http://localhost:3002
INTERNAL_TOKEN_DOC_ORG=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_WORKFLOW_DOC=internal-token-local-dev-change-in-prod
METADATA_EXTRACTOR_URL=http://localhost:3004
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
```

#### metadata-extractor-service

```env
PORT=3004
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=minio_admin
STORAGE_SECRET_KEY=minio_secret_local
STORAGE_BUCKET=documentos
STORAGE_FORCE_PATH=true
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=metadata-extractor-service
KAFKA_CONSUMER_GROUP=metadata-extractor-group
```

#### workflow-service

```env
PORT=3005
DB_HOST=localhost
DB_PORT=5432
DB_NAME=workflow_db
DB_USERNAME=workflow_user
DB_PASSWORD=workflow_pass_local
DB_POOL_SIZE=5
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
INTERNAL_TOKEN_WORKFLOW_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_WORKFLOW_DOC=internal-token-local-dev-change-in-prod
DOCUMENT_SERVICE_URL=http://localhost:3003
USER_SERVICE_URL=http://localhost:3001
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=workflow-service
```

#### notification-service

```env
PORT=3006
DB_HOST=localhost
DB_PORT=5432
DB_NAME=notification_db
DB_USERNAME=notification_user
DB_PASSWORD=notification_pass_local
DB_POOL_SIZE=5
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_local_pass
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
INTERNAL_TOKEN_NOTIF_USER=internal-token-local-dev-change-in-prod
INTERNAL_TOKEN_NOTIF_ORG=internal-token-local-dev-change-in-prod
USER_SERVICE_URL=http://localhost:3001
ORG_SERVICE_URL=http://localhost:3002
FRONTEND_URL=http://localhost:5173
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=notification-service
KAFKA_CONSUMER_GROUP=notification-service-group
```

#### audit-service

```env
PORT=3007
JWT_SECRET=sgd-jwt-secret-local-dev-change-in-prod
INTERNAL_TOKEN=internal-token-local-dev-change-in-prod
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_WRITE_USERNAME=elastic
ELASTICSEARCH_WRITE_PASSWORD=elastic_local_pass
ELASTICSEARCH_READ_USERNAME=elastic
ELASTICSEARCH_READ_PASSWORD=elastic_local_pass
KAFKA_BROKER=localhost:9094
KAFKA_CLIENT_ID=audit-service
KAFKA_CONSUMER_GROUP=audit-service-group
```

---

## Consumir la API

Todos los endpoints pasan por Kong en `http://localhost:8000`.

### Flujo básico

```bash
# 1. Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}'
# → { "accessToken": "eyJ...", "refreshToken": "eyJ..." }

# 2. Obtener orgs del usuario
curl http://localhost:8000/api/v1/auth/me/companies \
  -H "Authorization: Bearer <accessToken>"

# 3. Cambiar contexto a una org
curl -X POST http://localhost:8000/api/v1/auth/switch-company \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"companyId":"<orgId>"}'
# → { "accessToken": "eyJ..." }  ← token con companyId

# 4. Usar el token scoped para endpoints de org
curl http://localhost:8000/api/v1/documents/<orgId>/typologies \
  -H "Authorization: Bearer <tokenScoped>"
```

### Probar con Swagger

1. Abrir http://localhost:8000/api/v1/auth/docs
2. Ejecutar `POST /api/v1/auth/login`
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
| `AUDITOR` | Sistema | No |
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
| Rotación de kid | Soporte de `JWT_SECRET_KID` + `JWT_SECRET_PREV_KID` para rotación sin downtime |
| Rotación de refresh token | `GETDEL` atómico en Redis — previene replay con requests concurrentes |
| Token interno entre servicios | `timingSafeEqual` (previene timing attacks) |
| Login timing-safe | `bcrypt.compare` siempre corre aunque el usuario no exista (previene enumeración) |
| Validación de mensajes Kafka | Validación de esquema + `ObjectId.isValid()` antes de procesar cualquier mensaje |
| Rate limiting Kong | Por IP (10,000 req/min global) + por token JWT (`USER_RATE_LIMIT` req/min) |
| Rate limiting auth | `AUTH_SENSITIVE_RATE_LIMIT` en login/forgot-password · `AUTH_SESSION_RATE_LIMIT` en refresh |
| Swagger en producción | Rutas `/docs` protegidas con JWT en Railway |
| Subida de archivos | Validación de MIME type + límite de 20 MB |
| Trazabilidad | `x-correlation-id` propagado por Kong a todos los microservicios |
| SSE autenticación | Ticket efímero (Redis, TTL 30s) — evita JWT en query string |

---

## Trazabilidad distribuida

Kong genera un `x-correlation-id` (UUID) por cada request y lo propaga como header. Cada servicio:

1. Lee el header en `CorrelationMiddleware` (genera uno propio si no viene)
2. Lo almacena en `AsyncLocalStorage` durante el ciclo de vida del request
3. Lo incluye en cada línea de log vía `AppLogger`
4. Lo devuelve en la respuesta HTTP

Esto permite filtrar los logs de una request completa en todos los servicios con un único ID.

---

## Migraciones de base de datos

Los servicios con TypeORM (auth, user, org, workflow, notification) tienen el CLI configurado:

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

## Pruebas de rendimiento (k6)

Los tests de carga están en `tests/performance/`. Requieren [k6](https://k6.io) instalado.

### Test de lectura — 400 VUs

Simula usuarios leyendo workflows, orgs, usuarios y su perfil concurrentemente.

```bash
k6 run \
  -e BASE_URL=https://<api-gateway-url> \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/stress-test.js
```

**Resultados de referencia (Railway dev):** p95 = 102ms · 0% errores a 400 VUs

### Test de escritura — 250 VUs

Simula usuarios creando workflows concurrentemente (operación con escrituras en PostgreSQL + Kafka).

```bash
k6 run \
  -e BASE_URL=https://<api-gateway-url> \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/workflow-creation-stress-test.js
```

**Resultados de referencia (Railway dev):** p95 = 1.63s · 0% errores a 250 VUs · ~16 workflows/segundo

> **Requisito:** debe existir al menos una tipología activa en la org antes de correr el test de escritura.

---

## Despliegue en Railway

Railway es un PaaS: no usa Kubernetes. Cada microservicio es un servicio independiente con su propio `Dockerfile` y `railway.json`.

### Estrategia de ramas → entornos

```text
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
| Object storage | MinIO local | Cloudflare R2 |

### Variables de entorno en Railway

Los secrets **nunca** se almacenan en el repositorio. Se configuran por entorno en el dashboard o vía Railway CLI.

```bash
# Generar secrets seguros
openssl rand -hex 32   # JWT_SECRET / JWT_REFRESH_SECRET
openssl rand -hex 32   # INTERNAL_TOKEN_<ORIGEN>_<DESTINO>  (uno por par de servicios)
```

> **Regla de oro:** `JWT_SECRET` de dev ≠ test ≠ prod.
> `JWT_SECRET` debe ser **igual** en auth-service, user-service, org-service, document-service, workflow-service, notification-service y audit-service dentro del mismo entorno.
> `KONG_JWT_SECRET` debe ser **igual** al `JWT_SECRET` de auth-service.
> Cada `INTERNAL_TOKEN_*` debe ser idéntico en el servicio emisor y en el receptor (ver `railway/ENV_VARIABLES.md`).

### Variables Railway — auth-service (ejemplo)

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 32>
JWT_SECRET_KID=v1
JWT_REFRESH_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET_KID=v1
JWT_EXPIRATION=3600s
JWT_REFRESH_EXPIRATION=7d
SUPER_ADMIN_EMAIL=admin@empresa.com
SUPER_ADMIN_PASSWORD=<openssl rand -base64 16>
INTERNAL_TOKEN_AUTH_USER=<openssl rand -hex 32>
INTERNAL_TOKEN_USER_AUTH=<openssl rand -hex 32>
DB_NAME=auth_db
DB_HOST=${{postgres.PGHOST}}
DB_PORT=${{postgres.PGPORT}}
DB_USERNAME=${{postgres.PGUSER}}
DB_PASSWORD=${{postgres.PGPASSWORD}}
REDIS_HOST=${{redis.REDISHOST}}
REDIS_PORT=${{redis.REDISPORT}}
REDIS_PASSWORD=${{redis.REDISPASSWORD}}
USER_SERVICE_URL=http://user-service.railway.internal:3000
KAFKA_BROKER=kafka.railway.internal:9092
KAFKA_CLIENT_ID=auth-service
```

> Ver `railway/ENV_VARIABLES.md` para la lista completa de todos los servicios.

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
cd services/auth-service     && npm run migration:run
cd services/user-service     && npm run migration:run
cd services/org-service      && npm run migration:run
cd services/workflow-service && npm run migration:run
cd services/notification-service && npm run migration:run
```
