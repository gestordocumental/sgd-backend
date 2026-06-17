# user-service

Gestiona el ciclo de vida de usuarios: creación, invitación, perfil, avatar, asignación a organizaciones y control de roles y permisos. Es el servicio con más migraciones del sistema (25).

## Responsabilidades

- CRUD de usuarios con estado (`active`, `inactive`, `deleted`, `pending`)
- Flujo de invitación por email y registro completo (`complete-registration`)
- Asignación de usuarios a organizaciones con roles específicos
- Definición y asignación de roles y permisos por organización
- Upload de avatares a Cloudflare R2
- Exposición de permisos efectivos para que auth-service construya el JWT
- Gestión de super admins

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| PostgreSQL (`user_db`) | Usuarios, roles, permisos, asignaciones org |
| Redis | Caché de sesiones y permisos |
| Cloudflare R2 | Almacenamiento de avatares |
| Kafka (producer) | Eventos de usuario |

## Endpoints

### Usuarios (`/api/v1/users`)

| Método | Ruta | Permiso |
|---|---|---|
| `POST` | `/` | `USERS:WRITE` |
| `GET` | `/` | `USERS:READ` |
| `GET` | `/me` | autenticado |
| `GET` | `/me/org-roles` | autenticado |
| `PATCH` | `/me/avatar` | autenticado (multipart, máx. 5 MB) |
| `GET` | `/super-admins` | `USERS:READ` |
| `GET` | `/admin/counts-by-org` | super admin |
| `GET` | `/by-email/:email` | `USERS:READ` |
| `GET` | `/by-org/:orgId` | `USERS:READ` |
| `GET` | `/:id` | `USERS:READ` |
| `PATCH` | `/:id` | `USERS:WRITE` |
| `DELETE` | `/:id` | `USERS:DELETE` |
| `POST` | `/:id/restore` | `USERS:WRITE` |
| `PATCH` | `/:id/disable` | `USERS:WRITE` |
| `PATCH` | `/:id/enable` | `USERS:WRITE` |
| `POST` | `/:id/resend-invitation` | `USERS:WRITE` |
| `POST` | `/complete-registration` | público |
| `POST` | `/:id/provision` | `USERS:WRITE` |
| `PATCH` | `/:id/super-admin` | super admin |
| `POST` | `/:id/orgs` | `USERS:MANAGE` |
| `GET` | `/:id/orgs` | `USERS:READ` |
| `DELETE` | `/:id/orgs/:orgId` | `USERS:MANAGE` |
| `DELETE` | `/:id/orgs/:orgId/roles/:roleId` | `USERS:MANAGE` |
| `PATCH` | `/:id/orgs/:orgId/optional-reviewer` | `USERS:WRITE` |

### Roles (`/api/v1/roles`)

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/` | autenticado |
| `GET` | `/:id` | autenticado |
| `POST` | `/` | `ROLES:WRITE` |
| `PATCH` | `/:id` | `ROLES:WRITE` |
| `DELETE` | `/:id` | `ROLES:WRITE` |
| `POST` | `/:id/permissions` | `ROLES:WRITE` |
| `DELETE` | `/:id/permissions/:permissionId` | `ROLES:WRITE` |

### Internos (token requerido en header `x-internal-token`)

| Método | Ruta | Token | Llamado por |
|---|---|---|---|
| `GET` | `/:id/effective-permissions` | `INTERNAL_TOKEN_AUTH_USER` | auth-service |
| `GET` | `/:id/companies` | `INTERNAL_TOKEN_AUTH_USER` | auth-service |
| `DELETE` | `/internal/orgs/:orgId/users` | `INTERNAL_TOKEN_ORG_USER` | org-service |

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `user.invited` | Produce | Al crear un usuario nuevo |
| `user.org-removed` | Produce | Al eliminar un usuario de una org |
| `user.super-admin-revoked` | Produce | Al revocar privilegios de super admin |
| `user.permissions-changed` | Produce | Al modificar permisos de un usuario |

## Scripts

```bash
npm test                    # tests unitarios
npm run test:cov            # con cobertura (mínimo 85%)
npm run test:pact:consumer  # consumer pact tests
npm run test:pact:verify    # provider pact verification
npm run start:dev
npm run migration:show
npm run migration:run
npm run migration:generate -- src/migrations/NombreDescriptivo
npm run migration:revert
```

## Variables de entorno

Ver `services/user-service/.env.example`. Variables críticas:
- `DB_*` (PostgreSQL)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`
- `SUPER_ADMIN_EMAIL`
- `INTERNAL_TOKEN_AUTH_USER`, `INTERNAL_TOKEN_USER_AUTH`, `INTERNAL_TOKEN_ORG_USER`

## Migraciones

25 migraciones TypeORM. Incluyen: creación de tablas de usuarios, roles, permisos, asignaciones org, historial de estado y columnas de super admin.
