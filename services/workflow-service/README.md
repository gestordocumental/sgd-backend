# workflow-service

Gestiona el ciclo de vida completo de los workflows documentales: creación, flujo de aprobación por pasos, ciclo de revisión administrativa y cierre. Es el servicio de mayor complejidad de dominio del sistema.

## Responsabilidades

- CRUD de workflows con estado tipado (`DRAFT` → `PENDING_APPROVAL` → `AVAILABLE_FOR_FINAL_USERS` → `CLOSED`)
- Flujo de aprobación secuencial multi-paso con aprobación/rechazo/reenvío por cada aprobador
- Ciclo de revisión administrativa (`ADMIN_CYCLE_IN_PROGRESS`) con pasos opcionales delegables
- Soporte de idempotencia por header `Idempotency-Key` (caché Redis 24h)
- Timeline de eventos auditables para cada workflow
- Estadísticas por organización y uso de almacenamiento

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| PostgreSQL (`workflow_db`) | Workflows, pasos, acciones, adjuntos, ciclos admin, timeline |
| Redis | Caché de idempotencia (24h por key) |
| Kafka (producer) | Eventos del ciclo de vida del workflow |

## Llamadas HTTP a otros servicios

| Endpoint | Servicio destino | Cuándo |
|---|---|---|
| `GET /internal/typologies/:id/info` | document-service | Al crear un workflow, para obtener código y versión |

Token requerido: `INTERNAL_TOKEN_WORKFLOW_DOC`

## Endpoints (`/api/v1/workflows`)

### Consultas

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/stats` | Estadísticas de la organización |
| `GET` | `/admin/storage-per-org` | Uso de almacenamiento por org (super admin) |
| `GET` | `/my-tasks` | Workflows donde el usuario es aprobador pendiente |
| `GET` | `/my-available` | Workflows disponibles para el usuario como usuario final |
| `GET` | `/` | Listar todos (requiere `WORKFLOWS:MANAGE`) |
| `GET` | `/:id` | Detalle de un workflow |
| `GET` | `/:id/timeline` | Historial de eventos del workflow |

### Ciclo de vida base

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/` | Crear workflow en estado `DRAFT` |
| `PATCH` | `/:id` | Actualizar (solo en `DRAFT`) |
| `DELETE` | `/:id` | Eliminar (soft delete) |
| `POST` | `/:id/submit` | Enviar a aprobación (`DRAFT` → `PENDING_APPROVAL`) |
| `POST` | `/:id/cancel` | Cancelar workflow |
| `POST` | `/notify-no-final-users` | Notificar que una tipología no tiene usuarios finales |

### Flujo de aprobación

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/:id/approve` | Aprobador aprueba su paso |
| `POST` | `/:id/reject` | Aprobador rechaza (devuelve al creador) |
| `POST` | `/:id/return` | Devolver al creador con comentarios |
| `POST` | `/:id/resubmit` | Reenviar tras correcciones |

### Ciclo de revisión administrativa

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/:id/admin-cycles` | Iniciar ciclo de revisión admin |
| `POST` | `/:id/admin-cycles/:cycleId/skip` | Omitir el ciclo (ir directo a disponible) |
| `PATCH` | `/:id/admin-cycles/:cycleId/steps/:stepId/complete` | Completar un paso |
| `POST` | `/:id/admin-cycles/:cycleId/steps/:stepId/forward` | Delegar paso a revisor opcional |
| `POST` | `/:id/admin-cycles/:cycleId/finalize` | Finalizar ciclo completado |
| `POST` | `/:id/close` | Cerrar workflow (`AVAILABLE_FOR_FINAL_USERS` → `CLOSED`) |

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `workflow.created` | Produce | Al crear un workflow |
| `workflow.approval.started` | Produce | Al enviar a aprobación |
| `workflow.approval.approved` | Produce | Al aprobar un paso |
| `workflow.approval.rejected` | Produce | Al rechazar un paso |
| `workflow.approval.completed` | Produce | Al completar todos los pasos |
| `workflow.returned.to.creator` | Produce | Al devolver al creador |
| `workflow.resubmitted` | Produce | Al reenviar tras correcciones |
| `workflow.available.for.final.users` | Produce | Al quedar disponible para usuario final |
| `workflow.admin.cycle.started` | Produce | Al iniciar ciclo admin |
| `workflow.admin.cycle.step.completed` | Produce | Al completar paso admin |
| `workflow.admin.cycle.completed` | Produce | Al completar ciclo admin |
| `workflow.closed` | Produce | Al cerrar el workflow |
| `workflow.cancelled` | Produce | Al cancelar el workflow |
| `notification.send` | Produce | Notificaciones en hitos del flujo |
| `audit.log` | Produce | Registro de auditoría |

## Scripts

```bash
npm test
npm run test:cov
npm run start:dev
npm run start:debug   # inspector en puerto 9235
npm run migration:show
npm run migration:run
npm run migration:generate -- src/migrations/NombreDescriptivo
npm run migration:revert
```

## Variables de entorno

Ver `services/workflow-service/.env.example`. Variables críticas:
- `DB_*` (PostgreSQL)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`
- `INTERNAL_TOKEN_WORKFLOW_DOC` (para llamar a document-service)
- `DOCUMENT_SERVICE_URL`

## Migraciones

9 migraciones TypeORM. Incluyen: tablas de workflows, pasos de aprobación, acciones, adjuntos, notas, timeline y ciclos de revisión administrativa.

## Estados de un workflow

```text
DRAFT
  └─► PENDING_APPROVAL
        ├─► AVAILABLE_FOR_FINAL_USERS  (aprobado o ciclo admin completado)
        │     └─► PENDING_REVIEW_CYCLE  (si requiere revisión admin)
        │     │     └─► ADMIN_CYCLE_IN_PROGRESS
        │     │           └─► AVAILABLE_FOR_FINAL_USERS
        │     └─► CLOSED
        └─► CANCELLED
```
