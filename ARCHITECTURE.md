# Arquitectura del sistema — SGD Backend

Visión general de las decisiones de diseño, patrones de comunicación e infraestructura del sistema de gestión documental.

---

## Índice

1. [Vista general](#1-vista-general)
2. [Servicios y responsabilidades](#2-servicios-y-responsabilidades)
3. [Comunicación entre servicios](#3-comunicación-entre-servicios)
4. [Autenticación y autorización](#4-autenticación-y-autorización)
5. [Almacenamiento de datos](#5-almacenamiento-de-datos)
6. [Mensajería asíncrona (Kafka)](#6-mensajería-asíncrona-kafka)
7. [Observabilidad](#7-observabilidad)
8. [Paquete compartido @sgd/common](#8-paquete-compartido-sgdcommon)
9. [Decisiones de diseño](#9-decisiones-de-diseño)

---

## 1. Vista general

```
                          Internet
                              │
                    ┌─────────▼──────────┐
                    │   Kong API Gateway  │  DB-less, JWT validation,
                    │   (railway/api-     │  rate limiting, CORS
                    │    gateway)         │
                    └─────────┬──────────┘
                              │  HTTP interno (railway.internal)
          ┌───────────────────┼───────────────────────┐
          │                   │                       │
    ┌─────▼──────┐   ┌────────▼──────┐   ┌───────────▼────────┐
    │auth-service│   │ user-service  │   │   org-service      │
    │ (JWT, login│   │ (usuarios,    │   │ (organizaciones,   │
    │  sesiones) │   │  roles)       │   │  estructura)       │
    └────────────┘   └───────────────┘   └────────────────────┘
          │                   │                       │
          └───────────────────┼───────────────────────┘
                              │
          ┌───────────────────┼───────────────────────────────┐
          │                   │                               │
    ┌─────▼──────┐   ┌────────▼──────┐   ┌───────────────────▼──┐
    │ document-  │   │  workflow-    │   │  notification-service │
    │ service    │   │  service      │   │  (email, SSE)         │
    │ (MongoDB)  │   │  (PostgreSQL) │   │  (PostgreSQL + Redis) │
    └─────┬──────┘   └───────────────┘   └──────────────────────┘
          │
    ┌─────▼───────────────┐       ┌────────────────────┐
    │metadata-extractor-  │       │   audit-service    │
    │service (sin DB,     │       │   (Elasticsearch)  │
    │ solo R2 + Kafka)    │       └────────────────────┘
    └─────────────────────┘

                    ┌────────────────────────────┐
                    │  Kafka (mensajería async)  │  23 topics
                    └────────────────────────────┘

                    ┌────────────────────────────┐
                    │  Cloudflare R2             │  documentos, avatares
                    └────────────────────────────┘
```

---

## 2. Servicios y responsabilidades

| Servicio | Base de datos | Rol en el sistema |
|---|---|---|
| `auth-service` | PostgreSQL + Redis | Emite y rota JWTs. Único emisor de tokens del sistema |
| `user-service` | PostgreSQL + Redis | Usuarios, roles, permisos, asignaciones a orgs |
| `org-service` | PostgreSQL | Organizaciones y su estructura interna |
| `document-service` | MongoDB | Tipologías documentales y archivos subidos |
| `metadata-extractor-service` | — | Extrae metadatos de archivos via Kafka |
| `workflow-service` | PostgreSQL + Redis | Ciclo de vida completo de workflows |
| `notification-service` | PostgreSQL + Redis | Notificaciones en tiempo real (SSE) y email |
| `audit-service` | Elasticsearch | Registro inmutable de eventos del sistema |

---

## 3. Comunicación entre servicios

El sistema usa dos canales de comunicación, elegidos según la naturaleza de la operación:

### HTTP síncrono — para datos que se necesitan en el momento

Se usa cuando un servicio necesita una respuesta inmediata para continuar procesando la request del usuario.

```
auth-service  ──── GET /:id/effective-permissions ────► user-service
auth-service  ──── GET /:id/companies             ────► user-service
workflow-service ── GET /internal/typologies/:id/info ► document-service
org-service   ──── DELETE /internal/orgs/:orgId/users ► user-service
```

Todas las llamadas internas usan el patrón `INTERNAL_TOKEN_<EMISOR>_<RECEPTOR>` (ver sección 4.2).

### Kafka asíncrono — para eventos que no necesitan respuesta inmediata

Se usa para desacoplar servicios y permitir que cada uno procese a su ritmo sin bloquear la request original.

```
Ejemplo: flujo de extracción de metadatos

document-service
  └─► typology.file.uploaded
        └─► metadata-extractor-service
              ├─► typology.metadata.extracted  ──► document-service
              └─► typology.metadata.extraction.failed ──► document-service
```

---

## 4. Autenticación y autorización

### 4.1 JWT en el borde (Kong)

Kong valida el JWT en cada request antes de enrutarlo al servicio destino. Los servicios re-validan el token como defensa en profundidad (por si el pod es alcanzado directamente via port-forward u otro ingress alternativo).

El JWT contiene:
- `sub` — userId
- `email`
- `companyId` — organización activa (puede cambiar con `switch-company`)
- `isSuperAdmin`
- `permissions` — permisos efectivos del usuario en la org activa

### 4.2 Tokens internos por par de servicios

Las llamadas HTTP entre servicios no usan el JWT del usuario — usan tokens dedicados por par emisor-receptor.

**Patrón**: `INTERNAL_TOKEN_<EMISOR>_<RECEPTOR>`

```
INTERNAL_TOKEN_AUTH_USER   → auth-service llama a user-service
INTERNAL_TOKEN_USER_AUTH   → user-service llama a auth-service
INTERNAL_TOKEN_ORG_USER    → org-service llama a user-service
INTERNAL_TOKEN_WORKFLOW_DOC → workflow-service llama a document-service
```

El mismo valor se configura en ambos extremos: el emisor lo envía como header `x-internal-token`, el receptor lo lee y verifica con `timingSafeEqual`.

**Por qué por par y no un token global**: un token compartido significa que cualquier servicio comprometido puede impersonar cualquier otro. Con tokens por par, el radio de impacto de un secreto filtrado está acotado a la relación emisor-receptor específica.

Adicionalmente, `InternalGuard` verifica que el IP de origen esté dentro de `INTERNAL_ALLOWED_CIDRS` (en Railway: `100.64.0.0/10`), usando `socket.remoteAddress` en lugar de `x-forwarded-for` para evitar spoofing de header.

### 4.3 Sesiones de usuario

Los refresh tokens viven en una cookie `httpOnly` con `path=/api/v1/auth` — JavaScript del frontend no puede leerlos, lo que previene robo vía XSS.

La renovación del access token usa **Double-Submit Cookie** como protección CSRF:
- Al login se genera un UUID (`sgd_csrf_token`) que se setea en una cookie **legible por JS**
- El frontend lo lee y lo envía como header `x-csrf-token` en cada request de refresh/logout
- El servidor compara ambos con `timingSafeEqual` — un atacante cross-origin no puede leer la cookie de otro dominio

### 4.4 Permisos

Los permisos son modulares con la forma `(módulo, acción)`:

```
USERS:READ    USERS:WRITE    USERS:DELETE    USERS:MANAGE
ROLES:READ    ROLES:WRITE
DOCUMENTS:READ  DOCUMENTS:WRITE
WORKFLOWS:READ  WORKFLOWS:WRITE  WORKFLOWS:MANAGE
AUDIT:READ
ORG_STRUCTURE:READ  ORG_STRUCTURE:WRITE
```

Se verifican en cada servicio mediante `PermissionsGuard` + `@RequirePermission()`. Los permisos efectivos se calculan en user-service y se incluyen en el JWT para evitar un lookup en cada request.

---

## 5. Almacenamiento de datos

### Por qué una base de datos distinta por servicio

Cada servicio es dueño de sus datos y no accede directamente a la base de datos de otro. Esto permite escalar, migrar y hacer rollback de cada servicio de forma independiente.

| Servicio | Motor | Razón |
|---|---|---|
| auth, user, org, workflow, notification | **PostgreSQL** | Datos relacionales con integridad referencial, migraciones tipadas con TypeORM |
| document-service | **MongoDB** | Las tipologías tienen esquema variable (metadatos extraídos dependen del tipo de documento); MongoDB permite añadir campos sin migraciones |
| audit-service | **Elasticsearch** | El registro de auditoría es time-series con búsqueda full-text; Elasticsearch indexa y pagina millones de eventos con filtros complejos sin degradación |
| auth, user, notification, workflow | **Redis** | Datos efímeros: refresh tokens revocados, tickets SSE (30s TTL), caché de idempotencia (24h), caché de permisos |

### Almacenamiento de archivos (Cloudflare R2)

Los archivos (documentos de tipologías, avatares de usuarios, adjuntos de workflows) se almacenan en **Cloudflare R2**:
- Compatible con la API S3 — los servicios usan el SDK de AWS S3
- Sin costos de egress (a diferencia de S3)
- Acceso desde los servicios via credenciales `STORAGE_*` (endpoint, access key, secret, bucket)
- En local el `docker-compose.yml` provee **MinIO** como sustituto S3-compatible

### Escaneo de malware (ClamAV)

Antes de que cualquier archivo llegue a R2, document-service lo escanea contra el daemon `clamd` usando el protocolo INSTREAM (TCP):

```
POST /upload (buffer en memoria)
  └─► ClamavService.scan(buffer)   ← TCP a clamd:3310
        ├─► clean: true  → sube a R2, produce typology.file.uploaded
        └─► clean: false → rechaza con 422 (threat name en el log)
```

**Comportamiento si ClamAV no está disponible** (configurable por `CLAMAV_REQUIRED`):
- `CLAMAV_REQUIRED=false` (dev/test): log de warning + el upload continúa (fail-open)
- `CLAMAV_REQUIRED=true` (producción): upload bloqueado con 503 (fail-closed)

En Railway, `clamd` corre como servicio independiente accesible en `clamav.railway.internal:3310`. En local no hay sustituto — se opera con `CLAMAV_REQUIRED=false`.

---

## 6. Mensajería asíncrona (Kafka)

### Topología de topics

```
Emisor                    Topic                              Consumidor(es)
────────────────────────────────────────────────────────────────────────────
auth-service          auth.password-reset              notification-service
user-service          user.invited                     notification-service
user-service          user.org-removed                 notification-service
user-service          user.super-admin-revoked         notification-service
user-service          user.permissions-changed         (sin consumidor activo)
document-service      typology.file.uploaded           metadata-extractor-service
metadata-extractor    typology.metadata.extracted      document-service
metadata-extractor    typology.metadata.extraction.failed  document-service
workflow-service      workflow.created                 audit-service (drain)
workflow-service      workflow.approval.*              audit-service (drain)
workflow-service      workflow.closed / .cancelled     audit-service (drain), notification-service
workflow-service      notification.send                notification-service
cualquier servicio    audit.log                        audit-service
```

### Patrones de resiliencia

- **Dead-Letter Topic (DLT)**: mensajes que fallan tras reintentos se desvían a `<topic>.dlt` vía `withDlt()` de `@sgd/common`. Evitan bloquear el consumer group.
- **Correlación de trazas**: cada mensaje Kafka lleva un header `x-correlation-id` propagado por `runWithCorrelation()`. Permite rastrear una operación a través de múltiples servicios en los logs.
- **Consumer groups separados**: audit-service usa dos consumer groups — uno para `audit.log` y uno (`-workflow-drain` suffix) para `workflow.*`. Esto permite avanzar offsets de topics sin consumidor real sin interferir con el audit consumer principal.
- **`KAFKA_AUTO_CREATE_TOPICS_ENABLE=false`**: los topics deben existir antes de que un servicio intente producir. Se crean en el `kafka-init` del docker-compose (local) y manualmente en Railway.

---

## 7. Observabilidad

### Trazas (OpenTelemetry)

Cada servicio tiene un `instrument.ts` que llama a `initTracing()` de `@sgd/common`. Instrumenta automáticamente HTTP, Express, PostgreSQL, Redis y KafkaJS.

Es **no-op si `OTEL_EXPORTER_OTLP_ENDPOINT` no está definida** — los tests y entornos locales no necesitan ningún colector OTLP. En producción, apuntar al colector (Grafana Tempo, Jaeger, etc.).

### Métricas (Prometheus)

Cada servicio expone `/metrics` con `prom-client` a través de `MetricsModule` de `@sgd/common`. Registra latencia HTTP por ruta y código de estado.

En producción, `prometheus` (en Railway) hace scraping de cada servicio y **Grafana** visualiza los dashboards.

### Logs

`AppLogger` de `@sgd/common` emite JSON estructurado con Winston. Cada línea incluye `correlationId`, `serviceName` y nivel de log. En Railway los logs se consumen desde el dashboard o con `railway logs`.

### Auditoría de negocio

Separada de los logs técnicos. Cada acción relevante emite un mensaje a `audit.log` en Kafka, que `audit-service` persiste en Elasticsearch con filtros por org, actor y rango de fechas.

---

## 8. Paquete compartido `@sgd/common`

El monorepo tiene un único paquete interno (`packages/common`) que centraliza la infraestructura transversal compartida por todos los servicios:

```
packages/common/src/
├── tracing/        initTracing() — OpenTelemetry
├── correlation/    correlationStorage, getCorrelationId()
├── logger/         AppLogger (Winston estructurado)
├── interceptors/   LoggingInterceptor
├── filters/        HttpExceptionFilter
├── middleware/      CorrelationMiddleware
├── metrics/        MetricsModule, MetricsController, registry
├── kafka/          KafkaModule, KafkaProducerService, TOPICS, runWithCorrelation(), withDlt()
├── guards/         JwtGuard, PermissionsGuard, InternalGuard
└── decorators/     @Auth(), @OrgMember(), @JwtPayloadParam(), @RequirePermission(), @AllowInternalTokens()
```

**En producción** los servicios importan desde `packages/common/dist/` (compilado).
**En tests** Jest resuelve directamente el TypeScript source vía `moduleNameMapper`, sin necesitar build.

Agregar funcionalidad compartida aquí en lugar de duplicarla en cada servicio. Al modificar `@sgd/common`, ejecutar `npm run build:common` desde la raíz antes de correr cualquier servicio.

---

## 9. Decisiones de diseño

### Kong DB-less como API Gateway

Kong se ejecuta en modo `db=off` — lee su configuración desde un fichero YAML estático (`kong.yaml`) en lugar de una base de datos. Esto elimina una dependencia de infraestructura en el path crítico de cada request. El fichero se genera en la imagen Docker con variables de entorno sustituidas por `sed` en el `entrypoint.sh`.

**Consecuencia**: cambiar rutas o rate limits requiere hacer deploy de `api-gateway`, no solo cambiar una variable.

### CORS gestionado en Kong, no en los servicios

Los headers CORS (`Access-Control-Allow-Origin`, etc.) los añade Kong. Los servicios no configuran CORS — si lo hicieran, habría doble cabecera en las respuestas, lo que algunos browsers rechazan. El frontend URL se pasa a Kong como `FRONTEND_URL`.

### Notificaciones vía Resend, no SMTP

Resend ofrece mejor deliverability, logs de envío, y una API más simple que SMTP. No requiere gestionar un servidor de correo ni credenciales SMTP rotativas. El único tradeoff es la dependencia de un servicio externo.

### Tickets efímeros para SSE

El stream SSE en notification-service requiere autenticación, pero los `EventSource` del navegador no permiten headers personalizados (como `Authorization: Bearer`). La solución habitual de poner el JWT en la URL expone el token en logs de servidores y proxies.

La solución: el cliente obtiene primero un UUID de un solo uso (30s TTL en Redis) via `POST /stream/ticket`, y lo usa como query param en la URL SSE. El ticket se consume al validarse y no puede reutilizarse.

### Dos sistemas de token interno en document-service

document-service heredó dos mecanismos de autenticación interna que coexisten:

1. **`JwtGuard` legado** — acepta `x-internal-token` con el valor genérico `INTERNAL_TOKEN` en cualquier ruta
2. **`InternalGuard` nuevo** — valida `INTERNAL_TOKEN_WORKFLOW_DOC` + CIDR check, solo en rutas `/internal/*`

Ambos deben estar configurados. El plan a largo plazo es migrar todas las rutas internas al sistema nuevo y eliminar el token genérico.

### Drain consumer para topics `workflow.*` en audit-service

Los topics de Kafka acumulan lag si ningún consumer group los lee. audit-service suscribe un consumer group separado (`-workflow-drain`) a todos los topics `workflow.*` y los descarta silenciosamente. Esto mantiene el lag en cero hasta que se implemente un consumidor real para cada topic.
