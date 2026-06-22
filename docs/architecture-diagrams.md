# Diagramas de Arquitectura — SGD Helisa

**Versión:** 1.0  
**Fecha:** 2026-06-19  
**Sistema:** Sistema de Gestión Documental (SGD) Helisa

---

## Contenido

1. [Diagrama de capas](#1-diagrama-de-capas)
2. [Diagrama de componentes](#2-diagrama-de-componentes)
3. [Flujo de autenticación](#3-flujo-de-autenticación)

---

## 1. Diagrama de capas

El sistema se organiza en cinco capas horizontales. Cada capa solo se comunica con la inmediatamente adyacente, siguiendo el principio de separación de responsabilidades.

```mermaid
graph TD
    subgraph C1["① CAPA DE CLIENTE"]
        BR["🌐 Navegador Web\n(Chrome, Firefox, Edge)"]
    end

    subgraph C2["② CAPA DE PRESENTACIÓN"]
        CDN["Vercel CDN\n(caché estático global)"]
        SPA["React + Vite SPA\n(TypeScript, React Query,\nReact Router)"]
    end

    subgraph C3["③ CAPA DE API GATEWAY"]
        KONG["Kong API Gateway\n(modo DB-less)\n─────────────────\n✔ Validación JWT (HS256)\n✔ Rate limiting por IP y por usuario\n✔ CORS (origen permitido: FRONTEND_URL)\n✔ Security headers (CSP, HSTS, etc.)\n✔ Enrutamiento a microservicios"]
    end

    subgraph C4["④ CAPA DE MICROSERVICIOS"]
        direction LR
        AUTH["auth-service\n(autenticación,\nJWT, sesiones)"]
        USER["user-service\n(usuarios, roles,\npermisos)"]
        ORG["org-service\n(organizaciones,\nestructura)"]
        DOC["document-service\n(tipologías,\narchivos)"]
        META["metadata-extractor\n-service\n(extracción IA)"]
        WF["workflow-service\n(flujos documentales)"]
        NOTIF["notification-service\n(tiempo real SSE,\nemail)"]
        AUDIT["audit-service\n(registro inmutable)"]
    end

    subgraph C5["⑤ CAPA DE DATOS E INFRAESTRUCTURA"]
        direction LR
        PG["PostgreSQL\n(5 bases independientes:\nauth_db · user_db · org_db\nworkflow_db · notification_db)"]
        MONGO["MongoDB\n(document-service:\ntypologies)"]
        REDIS["Redis\n(refresh tokens, tickets SSE,\ncaché de permisos,\nidempotencia)"]
        ES["Elasticsearch\n(audit logs:\nbúsqueda full-text)"]
        KAFKA["Apache Kafka\n(mensajería asíncrona:\n23+ topics)"]
        R2["Cloudflare R2\n(archivos, documentos,\navatares)"]
        CLAM["ClamAV\n(antivirus INSTREAM\nTCP :3310)"]
        RESEND["Resend\n(envío de emails\ntransaccionales)"]
    end

    BR -->|"HTTPS"| CDN
    CDN --> SPA
    SPA -->|"HTTPS /api/*\n(proxy Vercel → Railway)"| KONG

    KONG -->|"HTTP interno\n*.railway.internal:3000"| AUTH
    KONG --> USER
    KONG --> ORG
    KONG --> DOC
    KONG --> META
    KONG --> WF
    KONG --> NOTIF
    KONG --> AUDIT

    AUTH --- PG
    USER --- PG
    ORG --- PG
    WF --- PG
    NOTIF --- PG

    DOC --- MONGO
    AUDIT --- ES

    AUTH --- REDIS
    USER --- REDIS
    WF --- REDIS
    NOTIF --- REDIS

    AUTH -.->|"Kafka"| KAFKA
    USER -.->|"Kafka"| KAFKA
    DOC -.->|"Kafka"| KAFKA
    META -.->|"Kafka"| KAFKA
    WF -.->|"Kafka"| KAFKA
    KAFKA -.->|"consume"| META
    KAFKA -.->|"consume"| DOC
    KAFKA -.->|"consume"| NOTIF
    KAFKA -.->|"consume"| AUDIT

    DOC -->|"INSTREAM TCP"| CLAM
    DOC -->|"S3 API"| R2
    META -->|"S3 API"| R2
    WF -->|"S3 API"| R2
    USER -->|"S3 API (avatares)"| R2
    NOTIF -->|"API REST"| RESEND
```

### Descripción de capas

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| **① Cliente** | Navegador web | Renderizado e interacción del usuario |
| **② Presentación** | React + Vite · Vercel CDN | SPA con enrutamiento client-side. Vercel sirve los estáticos desde CDN global y hace proxy de `/api/*` hacia Railway |
| **③ API Gateway** | Kong (DB-less) | Punto de entrada único. Valida JWT, aplica rate limiting y CORS antes de enrutar al microservicio correspondiente |
| **④ Microservicios** | NestJS (TypeScript) | 8 servicios independientes, cada uno dueño de su dominio de negocio y su base de datos |
| **⑤ Datos e Infraestructura** | PostgreSQL · MongoDB · Redis · Elasticsearch · Kafka · R2 · ClamAV · Resend | Persistencia, mensajería, almacenamiento de archivos y servicios externos |

---

## 2. Diagrama de componentes

Muestra cada microservicio como un componente con sus dependencias directas: bases de datos propias, servicios externos que consume y canales de comunicación hacia otros servicios.

```mermaid
graph LR
    %% ─── CLIENTE Y GATEWAY ─────────────────────────────────────────────────
    FE["🌐 Frontend\nReact + Vite\n(Vercel)"]
    KONG["🔀 Kong API Gateway\nDB-less · JWT · Rate Limit\nCORS · Security Headers"]

    FE -->|"HTTPS /api/v1/*"| KONG

    %% ─── MICROSERVICIOS ─────────────────────────────────────────────────────
    subgraph MS["MICROSERVICIOS  (*.railway.internal:3000)"]
        AUTH["auth-service"]
        USER["user-service"]
        ORG["org-service"]
        DOC["document-service"]
        META["metadata-extractor\n-service"]
        WF["workflow-service"]
        NOTIF["notification-service"]
        AUDIT["audit-service"]
    end

    KONG -->|"/api/v1/auth/*"| AUTH
    KONG -->|"/api/v1/users/*\n/api/v1/roles/*\n/api/v1/permissions"| USER
    KONG -->|"/api/v1/org/*"| ORG
    KONG -->|"/api/v1/documents/*"| DOC
    KONG -->|"/api/v1/workflows/*"| WF
    KONG -->|"/api/v1/notifications/*"| NOTIF
    KONG -->|"/api/v1/audit/*"| AUDIT

    %% ─── HTTP INTERNOS (service-to-service) ─────────────────────────────────
    AUTH -->|"GET /internal/users/:id/effective-permissions\nGET /internal/users/:id/companies\nx-internal-token"| USER
    USER -->|"DELETE /internal/orgs/:orgId/users\nx-internal-token"| AUTH
    ORG -->|"DELETE /internal/orgs/:orgId/users\nx-internal-token"| USER
    WF -->|"GET /internal/typologies/:id/info\nx-internal-token"| DOC

    %% ─── KAFKA (asíncrono) ───────────────────────────────────────────────────
    subgraph KF["Apache Kafka"]
        K1["auth.password-reset"]
        K2["user.invited\nuser.org-removed\nuser.super-admin-revoked"]
        K3["typology.file.uploaded"]
        K4["typology.metadata.extracted\ntypology.metadata.extraction.failed"]
        K5["notification.send\nworkflow.closed\nworkflow.cancelled"]
        K6["audit.log\nworkflow.*"]
    end

    AUTH -->|"produce"| K1
    USER -->|"produce"| K2
    DOC -->|"produce"| K3
    META -->|"produce"| K4
    WF -->|"produce"| K5
    WF -->|"produce"| K6
    AUTH -->|"produce"| K6
    USER -->|"produce"| K6
    DOC -->|"produce"| K6

    K1 -->|"consume"| NOTIF
    K2 -->|"consume"| NOTIF
    K3 -->|"consume"| META
    K4 -->|"consume"| DOC
    K5 -->|"consume"| NOTIF
    K6 -->|"consume"| AUDIT

    %% ─── BASES DE DATOS ──────────────────────────────────────────────────────
    subgraph DBS["PERSISTENCIA"]
        PG_AUTH[("PostgreSQL\nauth_db")]
        PG_USER[("PostgreSQL\nuser_db")]
        PG_ORG[("PostgreSQL\norg_db")]
        PG_WF[("PostgreSQL\nworkflow_db")]
        PG_NOTIF[("PostgreSQL\nnotification_db")]
        MONGO[("MongoDB\ntypologies")]
        ES[("Elasticsearch\naudit logs")]
        REDIS_AUTH[("Redis\nrefresh tokens\nrevocados")]
        REDIS_USER[("Redis\ncaché de\npermisos")]
        REDIS_WF[("Redis\nidempotencia\n24h TTL")]
        REDIS_NOTIF[("Redis\ntickets SSE\n30s TTL")]
    end

    AUTH --- PG_AUTH
    USER --- PG_USER
    ORG --- PG_ORG
    WF --- PG_WF
    NOTIF --- PG_NOTIF
    DOC --- MONGO
    AUDIT --- ES
    AUTH --- REDIS_AUTH
    USER --- REDIS_USER
    WF --- REDIS_WF
    NOTIF --- REDIS_NOTIF

    %% ─── SERVICIOS EXTERNOS ──────────────────────────────────────────────────
    subgraph EXT["SERVICIOS EXTERNOS"]
        R2["☁ Cloudflare R2\n(S3-compatible)\ndocumentos · avatares\nadjuntos de workflows"]
        CLAM["🛡 ClamAV\nantivirus\nTCP :3310"]
        RESEND["✉ Resend\nemail transaccional"]
    end

    DOC -->|"escaneo INSTREAM\nantes de subir"| CLAM
    DOC -->|"upload / presigned URL"| R2
    META -->|"download para\nprocesamiento"| R2
    WF -->|"upload adjuntos"| R2
    USER -->|"upload avatares"| R2
    NOTIF -->|"API REST"| RESEND
```

### Rutas públicas vs. protegidas en Kong

| Ruta | Método | JWT requerido | Servicio destino |
|---|---|---|---|
| `/api/v1/auth/login` | POST | No | auth-service |
| `/api/v1/auth/forgot-password` | POST | No | auth-service |
| `/api/v1/auth/reset-password` | POST | No | auth-service |
| `/api/v1/auth/refresh` | POST | No (usa cookie) | auth-service |
| `/api/v1/users/complete-registration` | POST | No | user-service |
| `/api/v1/notifications/stream` | GET | No (usa ticket efímero) | notification-service |
| `/health` | GET | No | Kong (respuesta local) |
| Todas las demás rutas `/api/v1/*` | * | **Sí** | Microservicio correspondiente |

### Tokens internos entre servicios

Las llamadas HTTP entre microservicios usan tokens dedicados por par emisor-receptor. No circula el JWT del usuario en llamadas internas.

| Emisor | Receptor | Variable de entorno |
|---|---|---|
| auth-service | user-service | `INTERNAL_TOKEN_AUTH_USER` |
| user-service | auth-service | `INTERNAL_TOKEN_USER_AUTH` |
| org-service | user-service | `INTERNAL_TOKEN_ORG_USER` |
| user-service | org-service | `INTERNAL_TOKEN_USER_ORG` |
| workflow-service | document-service | `INTERNAL_TOKEN_WORKFLOW_DOC` |
| notification-service | user-service | `INTERNAL_TOKEN_NOTIF_USER` |
| notification-service | org-service | `INTERNAL_TOKEN_NOTIF_ORG` |

---

## 3. Flujo de autenticación

### 3.1 Login y emisión de tokens

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Kong as Kong API Gateway
    participant Auth as auth-service
    participant User as user-service
    participant Redis as Redis

    Browser->>Kong: POST /api/v1/auth/login\n{email, password}
    Note over Kong: Ruta sin JWT plugin\n(rate limit reducido: N req/min por IP)
    Kong->>Auth: POST /api/v1/auth/login

    Auth->>Auth: Busca credencial por email en auth_db\nVerifica bcrypt(password, password_hash)\nVerifica status=active y locked_until

    Auth->>User: GET /internal/users/:id/effective-permissions\nx-internal-token: INTERNAL_TOKEN_AUTH_USER
    User-->>Auth: {permissions[], orgRoles[]}

    Auth->>User: GET /internal/users/:id/companies\nx-internal-token: INTERNAL_TOKEN_AUTH_USER
    User-->>Auth: {companies[], activeCompanyId}

    Auth->>Auth: Genera Access Token JWT (HS256)\nclaims: sub, email, companyId,\nisSuperAdmin, permissions\nTTL: 15 min

    Auth->>Auth: Genera Refresh Token (UUID v4)\nCalcula SHA-256 hash

    Auth->>Redis: SETEX refresh_token:{userId}:{tokenId}\nhash + metadata\nTTL: 7 días

    Auth->>Auth: Genera CSRF token (UUID v4)

    Auth-->>Kong: 200 {accessToken}\nSet-Cookie: refresh_token=<UUID> (httpOnly, Secure, SameSite=Strict, path=/api/v1/auth)\nSet-Cookie: sgd_csrf_token=<UUID> (readable por JS, SameSite=Strict)
    Kong-->>Browser: 200 {accessToken} + cookies

    Note over Browser: Almacena accessToken en memoria JS\n(NO en localStorage)\nLee sgd_csrf_token de cookie
```

### 3.2 Solicitud autenticada

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Kong as Kong API Gateway
    participant Svc as Microservicio destino

    Browser->>Kong: POST /api/v1/workflows\nAuthorization: Bearer <accessToken>\nX-Company-Id: <orgId>

    Note over Kong: Plugin JWT activo:\n1. Extrae token del header Authorization\n2. Verifica firma HS256 con KONG_JWT_SECRET\n3. Verifica exp (15 min)\n4. Rechaza con 401 si inválido o expirado

    Kong->>Svc: POST /api/v1/workflows\n(headers del usuario propagados)

    Note over Svc: Re-valida JWT internamente (defensa en profundidad)\nExtrae claims: userId, orgId, permissions\nVerifica permisos con @RequirePermission()

    Svc-->>Kong: 201 {workflow}
    Kong-->>Browser: 201 {workflow}
```

### 3.3 Renovación del Access Token (Refresh)

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Kong as Kong API Gateway
    participant Auth as auth-service
    participant Redis as Redis

    Note over Browser: Access Token expirado (15 min)\nTiene refresh_token en cookie httpOnly\ny sgd_csrf_token en cookie legible

    Browser->>Kong: POST /api/v1/auth/refresh\nCookie: refresh_token=<UUID>\nx-csrf-token: <UUID del sgd_csrf_token>
    Note over Kong: Ruta sin JWT plugin\n(no requiere accessToken)

    Kong->>Auth: POST /api/v1/auth/refresh

    Auth->>Auth: Compara x-csrf-token con cookie sgd_csrf_token\n(timingSafeEqual — protección CSRF)

    Auth->>Redis: GET refresh_token:{userId}:{tokenId}
    Redis-->>Auth: {hash, metadata} | NULL

    alt Refresh token válido y no revocado
        Auth->>Auth: Verifica SHA-256(cookie) === hash almacenado
        Auth->>Redis: DEL refresh_token:{userId}:{tokenId}\n(rotación — el token anterior queda revocado)
        Auth->>Auth: Genera nuevo Access Token JWT\nGenera nuevo Refresh Token
        Auth->>Redis: SETEX refresh_token:{userId}:{newTokenId}\nTTL: 7 días
        Auth-->>Kong: 200 {accessToken}\nSet-Cookie: refresh_token=<newUUID> (httpOnly)\nSet-Cookie: sgd_csrf_token=<newUUID>
        Kong-->>Browser: 200 {accessToken} + nuevas cookies
    else Refresh token inválido, expirado o revocado
        Auth-->>Kong: 401 Unauthorized
        Kong-->>Browser: 401 — el usuario debe volver a hacer login
    end
```

### 3.4 Notificaciones en tiempo real (SSE con ticket efímero)

El navegador no puede enviar headers `Authorization` en conexiones `EventSource`. Para no exponer el JWT en la URL, se usa un ticket de un solo uso.

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Kong as Kong API Gateway
    participant Notif as notification-service
    participant Redis as Redis

    Browser->>Kong: POST /api/v1/notifications/stream/ticket\nAuthorization: Bearer <accessToken>
    Note over Kong: JWT validado por Kong
    Kong->>Notif: POST /stream/ticket

    Notif->>Notif: Genera UUID de un solo uso
    Notif->>Redis: SETEX sse_ticket:{uuid} userId\nTTL: 30 segundos
    Notif-->>Browser: 200 {ticket: <uuid>}

    Browser->>Kong: GET /api/v1/notifications/stream?ticket=<uuid>
    Note over Kong: Ruta sin JWT plugin\n(autenticación delegada al servicio)
    Kong->>Notif: GET /stream?ticket=<uuid>\n(timeout Kong: 24h para SSE)

    Notif->>Redis: GET sse_ticket:{uuid}
    Redis-->>Notif: userId | NULL (expirado)

    alt Ticket válido
        Notif->>Redis: DEL sse_ticket:{uuid}\n(consumido — no reutilizable)
        Notif-->>Browser: 200 text/event-stream\nConexión SSE abierta (long-lived)
        loop Eventos en tiempo real
            Notif-->>Browser: data: {type, title, message, ...}\n\n
        end
    else Ticket inválido o expirado
        Notif-->>Browser: 401 Unauthorized
    end
```

### 3.5 Cierre de sesión (Logout)

```mermaid
sequenceDiagram
    autonumber
    actor Browser
    participant Kong as Kong API Gateway
    participant Auth as auth-service
    participant Redis as Redis

    Browser->>Kong: POST /api/v1/auth/logout\nAuthorization: Bearer <accessToken>\nCookie: refresh_token=<UUID>\nx-csrf-token: <UUID>

    Note over Kong: JWT validado por Kong
    Kong->>Auth: POST /api/v1/auth/logout

    Auth->>Auth: Verifica CSRF (timingSafeEqual)
    Auth->>Redis: DEL refresh_token:{userId}:{tokenId}\n(revoca el refresh token inmediatamente)

    Auth-->>Kong: 200 OK\nSet-Cookie: refresh_token=; Max-Age=0 (elimina cookie)\nSet-Cookie: sgd_csrf_token=; Max-Age=0
    Kong-->>Browser: 200 OK + cookies eliminadas

    Note over Browser: Access Token sigue siendo técnicamente válido\nhasta su expiración natural (máx. 15 min)\nEn la práctica es inutilizable porque Kong\nno tiene lista de revocación de JWTs —\nel riesgo está acotado a la ventana de 15 min
```

---

### Resumen de seguridad en la capa de autenticación

| Mecanismo | Protección contra |
|---|---|
| JWT con TTL de 15 minutos | Ventana de exposición reducida si un token es interceptado |
| Refresh token en cookie `httpOnly` | Robo de token vía JavaScript (XSS) |
| Double-Submit Cookie (CSRF token) | Ataques CSRF en la operación de refresh |
| `SameSite=Strict` en cookies | CSRF en la mayoría de navegadores modernos |
| Ticket efímero para SSE (30s TTL) | Exposición del JWT en URL/logs al abrir stream SSE |
| Rate limiting por IP en `/login` | Ataques de fuerza bruta |
| `timingSafeEqual` en tokens internos | Timing attacks en comparación de secretos |
| CIDR check en llamadas internas (`100.64.0.0/10`) | Llamadas internas no autorizadas desde IPs externas |
| Kong como único punto de entrada | Superficie de ataque reducida; servicios no expuestos directamente |
