# Índice de Documentación Técnica — SGD Helisa

**Versión:** 1.0  
**Fecha de entrega:** 2026-06-19  
**Sistema:** Sistema de Gestión Documental (SGD) Helisa  
**Proveedor:** Proasistemas Apps  

---

## Descripción del sistema

El SGD Helisa es una plataforma web multi-tenant de gestión documental que permite a organizaciones:

- Definir **tipologías documentales** con metadatos extraídos automáticamente de archivos PDF/Office.
- Ejecutar **flujos de aprobación** secuencial de documentos con múltiples aprobadores.
- Gestionar **ciclos administrativos** de tramitación interna una vez aprobados los documentos.
- Recibir **notificaciones en tiempo real** (SSE) y por correo en cada evento del proceso.
- Consultar un **registro de auditoría** inmutable de todas las acciones del sistema.

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend | React + Vite + TypeScript | React 18 |
| API Gateway | Kong (modo DB-less, declarativo) | 3.x |
| Backend | NestJS + TypeScript | 11.x |
| ORM relacional | TypeORM | 0.3.x |
| ODM documental | Mongoose | 8.x |
| Base de datos relacional | PostgreSQL | 15 |
| Base de datos documental | MongoDB | 7 |
| Caché / sesiones | Redis | 7 |
| Motor de búsqueda | Elasticsearch | 8.11 |
| Mensajería | Apache Kafka (KRaft) | latest |
| Almacenamiento de archivos | Cloudflare R2 (S3-compatible) | — |
| Antivirus | ClamAV | Latest |
| Email transaccional | Resend | — |
| Observabilidad | OpenTelemetry + Prometheus + Grafana | — |
| Hosting backend | Railway | — |
| Hosting frontend | Vercel | — |
| CI/CD | GitHub Actions | — |

---

## Documentos de esta entrega

### 1. Arquitectura del sistema

| Documento | Ubicación | Contenido |
|---|---|---|
| **Diagramas de arquitectura** | [`docs/architecture-diagrams.md`](./architecture-diagrams.md) | Diagrama de capas (5 niveles), diagrama de componentes con todas las dependencias, flujos de autenticación JWT con diagramas de secuencia (login, refresh, SSE, logout) |
| **Decisiones de arquitectura** | [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Patrones de comunicación, decisiones de diseño con justificación (Kong DB-less, CORS en gateway, tickets SSE, tokens internos por par), topología Kafka con 23+ topics |

---

### 2. Base de datos

| Documento | Ubicación | Contenido |
|---|---|---|
| **Diagramas ER y diccionario de datos** | [`docs/database-documentation.md`](./database-documentation.md) | Diagramas ER en Mermaid para cada base de datos, diccionario de datos con tipo, nulo, default y descripción de cada columna, índices y restricciones, catálogo completo de enumeraciones, mapa de referencias cruzadas entre servicios |

**Bases de datos cubiertas:**

| Base de datos | Motor | Servicio propietario | Tablas / Colecciones |
|---|---|---|---|
| `auth_db` | PostgreSQL | auth-service | `credentials` |
| `user_db` | PostgreSQL | user-service | `users`, `roles`, `permissions`, `role_permissions`, `user_org_roles` |
| `org_db` | PostgreSQL | org-service | `orgs`, `departamentos`, `areas`, `cargos` |
| `workflow_db` | PostgreSQL | workflow-service | `workflows`, `workflow_approval_steps`, `workflow_approval_actions`, `workflow_attachments`, `workflow_admin_cycles`, `workflow_admin_steps`, `workflow_admin_attachments`, `workflow_notes`, `workflow_timeline`, `workflow_idempotency_keys` |
| `notification_db` | PostgreSQL | notification-service | `notifications` |
| `document-service` | MongoDB | document-service | `typologies` (con subdocumentos embebidos) |

---

### 3. Procesos de negocio

| Documento | Ubicación | Contenido |
|---|---|---|
| **Diagrama de flujo del workflow documental** | [`docs/workflow-diagrams.md`](./workflow-diagrams.md) | Máquina de estados (9 estados, tabla de transiciones), flujo completo del proceso con swim lanes por actor (Creador, Aprobador, Usuario Final, Revisor Opcional), ciclo administrativo en detalle con revisores opcionales, 15 reglas de negocio, tabla de notificaciones por evento |

**Estados del workflow:**

```text
DRAFT → PENDING_APPROVAL → PENDING_REVIEW_CYCLE → AVAILABLE_FOR_FINAL_USERS → CLOSED ✅
                         ↘ REJECTED ❌            ↕ ADMIN_CYCLE_IN_PROGRESS ↕
```

---

### 4. Infraestructura y despliegue

| Documento | Ubicación | Contenido |
|---|---|---|
| **Diagrama de despliegue Railway** | [`docs/deployment-diagram.md`](./deployment-diagram.md) | Pipeline CI/CD con 3 entornos (develop / staging / production), topología completa de infraestructura en Railway, red interna `*.railway.internal`, inventario de servicios con hostnames y puertos, variables de entorno compartidas críticas |
| **Guía de despliegue paso a paso** | [`railway/DEPLOYMENT_GUIDE.md`](../railway/DEPLOYMENT_GUIDE.md) | Instrucciones completas para crear un entorno Railway desde cero, configuración de plugins (PostgreSQL, Redis, MongoDB), configuración de Kafka y Elasticsearch, CI/CD con GitHub Actions, proceso de aprobación manual para producción |
| **Variables de entorno por servicio** | [`railway/ENV_VARIABLES.md`](../railway/ENV_VARIABLES.md) | Tabla completa de todas las variables de entorno de cada microservicio para los 3 entornos, con fuente (plugin Railway vs. manual) y notas de sincronización entre servicios |

**Entornos:**

| Entorno Railway | Rama Git | Dominio API | Propósito |
|---|---|---|---|
| `develop` | `dev` | `https://api-gateway-develop-xxx.up.railway.app` | Desarrollo y pruebas de integración |
| `staging` | `test` | `https://api-gateway-staging-xxx.up.railway.app` | QA y pruebas de aceptación |
| `production` | `master` | `https://api.helisa.com` *(pendiente DNS)* | Producción |

---

### 5. Operaciones y mantenimiento

| Documento | Ubicación | Contenido |
|---|---|---|
| **Runbook de migraciones** | [`RUNBOOK.md`](../RUNBOOK.md) | Lista de verificación pre-despliegue, procedimiento de migraciones TypeORM en producción, ventana de rollback, catálogo de seguridad de migraciones (seguras vs. destructivas), procedimiento de contingencia ante fallo de migración |

---

### 6. Guía para desarrolladores

| Documento | Ubicación | Contenido |
|---|---|---|
| **Guía de contribución** | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Convenciones de código, flujo de ramas, cómo correr el entorno local con Docker Compose, ejecutar tests, estructura de paquetes, publicación del paquete `@sgd/common` |
| **README del proyecto** | [`README.md`](../README.md) | Vista general del sistema, mapeo de rutas Kong → servicios, instrucciones de arranque local |

---

## Estructura de repositorios

El sistema se divide en dos repositorios Git:

```text
document-management-system/          ← BACKEND (este repo)
├── services/
│   ├── auth-service/
│   ├── user-service/
│   ├── org-service/
│   ├── document-service/
│   ├── metadata-extractor-service/
│   ├── workflow-service/
│   ├── notification-service/
│   └── audit-service/
├── packages/
│   └── common/                      ← paquete interno @sgd/common
├── railway/
│   ├── api-gateway/                 ← Kong (kong.yaml + Dockerfile)
│   ├── monitoring/                  ← Prometheus
│   ├── api-docs/                    ← Documentación Swagger estática
│   └── postgres-init/               ← Script de inicialización de bases de datos
└── docs/                            ← ← ← ESTA DOCUMENTACIÓN

document-management-system-web/      ← FRONTEND (repo separado)
└── sgd-frontend/
    └── src/
```

---

## Accesos y credenciales

> Los accesos a los entornos deben ser solicitados directamente al proveedor. No se incluyen credenciales en este documento.

| Recurso | Cómo acceder |
|---|---|
| Railway (infraestructura) | Invitación al proyecto Railway vía email |
| GitHub (código fuente) | Invitación al repositorio GitHub |
| Vercel (frontend) | Invitación al proyecto Vercel |
| Cloudflare R2 (archivos) | API tokens proporcionados por separado |
| Grafana (métricas, solo producción) | URL pública en Railway, credenciales por separado |
| API de producción | `https://api.helisa.com` — requiere JWT (login vía POST `/api/v1/auth/login`) |
| Documentación Swagger | `https://docs-xxx.railway.app` — requiere JWT de administrador |

---

## Glosario

| Término | Definición |
|---|---|
| **Tipología documental** | Plantilla que define el tipo de documento, su estructura de metadatos y la estructura organizacional a la que aplica |
| **Workflow** | Instancia de tramitación de un documento específico que sigue un ciclo de aprobación y gestión administrativa |
| **Ciclo de aprobación** | Secuencia de pasos donde cada aprobador, en orden, revisa y aprueba o rechaza el documento |
| **Ciclo administrativo** | Proceso interno de tramitación que ocurre después de la aprobación, ejecutado por responsables administrativos |
| **Usuario final** | Usuario de la organización designado para recibir el workflow una vez completado el ciclo de aprobación, iniciar ciclos administrativos y cerrar el proceso |
| **Revisor opcional** | Usuario que puede ser incorporado dinámicamente a un paso de un ciclo administrativo como revisor adicional |
| **SSE** | Server-Sent Events — tecnología de notificaciones en tiempo real desde el servidor hacia el navegador |
| **Kong DB-less** | Modo de operación del API Gateway Kong donde la configuración se lee de un archivo YAML estático en lugar de una base de datos |
| **Multi-tenant** | El sistema permite que múltiples organizaciones operen de forma aislada dentro de la misma plataforma |
| **R2** | Servicio de almacenamiento de objetos de Cloudflare, compatible con la API de Amazon S3 |
| **KRaft** | Modo de operación de Kafka sin dependencia de ZooKeeper (propio de versiones modernas) |
