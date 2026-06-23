# org-service

Gestiona las organizaciones (empresas) del sistema y su estructura interna: áreas, cargos, departamentos y sus relaciones. Es el único servicio que puede crear y eliminar organizaciones.

## Responsabilidades

- CRUD de organizaciones con soft delete y restauración
- Gestión de la estructura organizacional: áreas, cargos, departamentos, relaciones cargo-departamento y cargo-organización
- Importación masiva de estructura vía bulk upload
- Exposición de estructura interna para otros servicios (endpoint interno)
- Al eliminar una organización, notifica a user-service para revocar accesos

## Infraestructura requerida

| Recurso | Uso |
|---|---|
| PostgreSQL (`org_db`) | Organizaciones y su estructura |
| Kafka (producer) | Eventos de auditoría (`audit.log`) |

## Endpoints

### Organizaciones (`/api/v1/org`)

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/` | super admin |
| `GET` | `/` | super admin (cursor-paginado, con search y filtro de status) |
| `GET` | `/mine` | autenticado (resuelve orgs por lista de IDs) |
| `GET` | `/:id` | miembro de la org o super admin |
| `PATCH` | `/:id` | miembro de la org o super admin |
| `DELETE` | `/:id` | super admin (soft delete) |
| `POST` | `/:id/restore` | super admin |

### Estructura de organización (`/api/v1/org/:orgId/...`)

| Recurso | Rutas |
|---|---|
| Áreas | `GET /areas` |
| Cargos | `GET /cargos`, `GET /cargos/:id`, `POST /cargos`, `PATCH /cargos/:id`, `DELETE /cargos/:id` |
| Departamentos | `GET /departamentos`, `GET /departamentos/:id`, `POST /departamentos`, `PATCH /departamentos/:id`, `DELETE /departamentos/:id` |
| Cargos por departamento | `GET /departamentos/:deptId/cargos`, `POST /departamentos/:deptId/cargos`, `DELETE /departamentos/:deptId/cargos/:cargoId` |
| Cargos de la org | `GET /org-cargos` |
| Importación masiva | `POST /bulk-structure` |

### Internos (`/api/v1/org/internal/...`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/internal/structure/:orgId` | Estructura completa para otros servicios |

## Kafka

| Topic | Rol | Cuándo |
|---|---|---|
| `audit.log` | Produce | Acciones sobre organizaciones y estructura |

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

Ver `services/org-service/.env.example`. Variables críticas:
- `DB_*` (PostgreSQL)
- `JWT_SECRET`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`
- `INTERNAL_TOKEN_ORG_USER` (para notificar a user-service al eliminar org)
- `USER_SERVICE_URL`

## Migraciones

4 migraciones TypeORM. Incluyen: creación de tablas de organizaciones, áreas, cargos, departamentos y sus relaciones.
