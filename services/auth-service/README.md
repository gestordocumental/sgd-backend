# auth-service

Gestiona la autenticación de usuarios: login, refresh de tokens, logout, recuperación de contraseña y cambio de contexto de empresa. Es el único servicio que emite JWTs — todos los demás los validan.

## Responsabilidades

- Emitir y rotar pares de tokens (access token JWT + refresh token httpOnly cookie)
- Doble protección CSRF con patrón Double-Submit Cookie
- Rate limiting por tipo de operación (configurable en Kong)
- Provisión y gestión de credenciales de usuarios (invocado por user-service)
- Cambio de contexto de empresa (`switch-company` / `exit-company`)

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| PostgreSQL (`auth_db`) | Credenciales, refresh tokens, historial de contraseñas |
| Redis | Lista negra de refresh tokens revocados |
| Kafka (producer) | Emite `auth.password-reset` |

## Llamadas HTTP a otros servicios

| Endpoint | Servicio destino | Cuándo |
|---|---|---|
| `GET /:id/effective-permissions` | user-service | Al construir el JWT con permisos |
| `GET /:id/companies` | user-service | Al resolver las empresas del usuario |

Token requerido: `INTERNAL_TOKEN_AUTH_USER`

## Endpoints

### Públicos (sin JWT)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Login con email y contraseña |
| `POST` | `/api/v1/auth/refresh` | Rotar access token usando cookie de refresh |
| `POST` | `/api/v1/auth/logout` | Revocar sesión y limpiar cookies |
| `POST` | `/api/v1/auth/forgot-password` | Solicitar email de recuperación |
| `POST` | `/api/v1/auth/reset-password` | Cambiar contraseña con token de email |

### Autenticados (JWT requerido)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/auth/me` | Datos del usuario autenticado |
| `GET` | `/api/v1/auth/me/companies` | Empresas a las que pertenece el usuario |
| `POST` | `/api/v1/auth/switch-company` | Cambiar al contexto de una empresa |
| `POST` | `/api/v1/auth/exit-company` | Volver al contexto global (super admin) |

### Internos (InternalGuard — `INTERNAL_TOKEN_USER_AUTH`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/auth/credentials/provision` | Crear credenciales para un nuevo usuario |
| `PATCH` | `/api/v1/auth/credentials/:userId/disable` | Deshabilitar acceso |
| `PATCH` | `/api/v1/auth/credentials/:userId/revoke-tokens` | Revocar todas las sesiones activas |
| `PATCH` | `/api/v1/auth/credentials/:userId/enable` | Re-habilitar acceso |

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `auth.password-reset` | Produce | Al solicitar recuperación de contraseña |

## Scripts

```bash
npm test                  # tests unitarios
npm run test:cov          # con cobertura (mínimo 85%)
npm run test:int          # tests de integración (requiere PostgreSQL + Redis reales)
npm run test:pact:consumer  # consumer pact tests (contrato con user-service)
npm run test:pact:verify    # provider pact verification
npm run start:dev         # modo watch
npm run migration:show    # estado de migraciones
npm run migration:run     # aplicar migraciones pendientes
npm run migration:generate -- src/migrations/NombreDescriptivo
npm run migration:revert  # revertir última migración
```

## Variables de entorno

Ver `services/auth-service/.env.example` para la lista completa con valores de ejemplo para desarrollo local.

Variables críticas al arrancar (la aplicación no levanta si faltan):
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`
- `REDIS_HOST`, `REDIS_PORT`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`
- `USER_SERVICE_URL`
- `INTERNAL_TOKEN_AUTH_USER`, `INTERNAL_TOKEN_USER_AUTH`

## Migraciones

3 migraciones TypeORM. Se aplican automáticamente en producción con `npm run start:migrate`.
