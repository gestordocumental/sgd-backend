# notification-service

Entrega notificaciones a usuarios en tiempo real (SSE) y por email (Resend). Consume eventos de Kafka emitidos por otros servicios y persiste el historial de notificaciones por usuario.

## Responsabilidades

- Consumir eventos Kafka y convertirlos en notificaciones persistentes
- Entregar notificaciones en tiempo real vía Server-Sent Events (SSE)
- Enviar emails transaccionales a través de la API de Resend
- Gestionar el estado de lectura de notificaciones por usuario
- Emisión de tickets efímeros (Redis, 30s TTL) para autenticar la conexión SSE sin exponer el JWT en la URL

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| PostgreSQL (`notification_db`) | Historial de notificaciones persistidas |
| Redis | Tickets SSE (30s TTL) y gestión de conexiones activas |
| Kafka (consumer) | Recibe eventos de otros servicios |
| Resend API | Envío de emails transaccionales |

## Endpoints (`/api/v1/notifications`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/stream/ticket` | Obtener ticket efímero para conectar al stream SSE |
| `GET` | `/stream?ticket=<uuid>` | Stream SSE de notificaciones en tiempo real |
| `GET` | `/` | Listar notificaciones del usuario (paginado) |
| `GET` | `/unread-count` | Cantidad de notificaciones no leídas |
| `PATCH` | `/read-all` | Marcar todas como leídas |
| `PATCH` | `/:id/read` | Marcar una notificación como leída |

### Flujo de conexión SSE

```text
1. Cliente autentica con JWT normal → POST /stream/ticket → { ticket, expiresIn: 30 }
2. Cliente abre EventSource con GET /stream?ticket=<uuid>
3. SseTicketGuard valida el ticket en Redis (se consume una sola vez)
4. El stream emite eventos hasta que el cliente cierra la conexión
```

El ticket de un solo uso evita que el JWT quede expuesto en logs de servidores y proxies.

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `notification.send` | Consume | Notificación genérica desde cualquier servicio |
| `user.invited` | Consume | Envía email de invitación con token de registro |
| `user.org-removed` | Consume | Notifica al usuario que fue removido de una org |
| `user.super-admin-revoked` | Consume | Notifica al usuario la revocación de privilegios |
| `auth.password-reset` | Consume | Envía email con link de recuperación de contraseña |

## Tipos de notificación

Los tipos están definidos en `src/notifications/entities/notification.entity.ts`. Incluyen: `WORKFLOW_CREATED`, `WORKFLOW_APPROVED`, `WORKFLOW_REJECTED`, `WORKFLOW_AVAILABLE`, `WORKFLOW_CLOSED`, `USER_INVITED`, `USER_ORG_REMOVED`, `PASSWORD_RESET`, `NO_FINAL_USER_ALERT`, entre otros.

## Scripts

```bash
npm test
npm run test:cov
npm run start:dev
npm run migration:show
npm run migration:run
npm run migration:generate -- src/migrations/NombreDescriptivo
npm run migration:revert
```

## Variables de entorno

Ver `services/notification-service/.env.example`. Variables críticas:
- `DB_*` (PostgreSQL)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `RESEND_API_KEY`, `RESEND_FROM`
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP`

> Este servicio usa **Resend** para email, no SMTP. `RESEND_FROM` debe ser un dominio verificado en el dashboard de Resend.

## Migraciones

2 migraciones TypeORM. Incluyen: tabla de notificaciones con estado de lectura e índices por usuario.
