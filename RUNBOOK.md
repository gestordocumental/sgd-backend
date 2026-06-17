# Runbook de Migraciones — Sistema de Gestión Documental

> **Audiencia:** Ingenieros backend y DevOps que realizan despliegues a producción que incluyen migraciones TypeORM.
> **Alcance:** Bases de datos PostgreSQL de todos los servicios (user-service, workflow-service, auth-service, org-service, notification-service).

---

## Tabla de contenidos

1. [Lista de verificación pre-despliegue](#1-lista-de-verificación-pre-despliegue)
2. [Ejecutar migraciones en producción](#2-ejecutar-migraciones-en-producción)
3. [Ventana de rollback y procedimiento](#3-ventana-de-rollback-y-procedimiento)
4. [Contingencia — migración falla a mitad de ejecución](#4-contingencia--migración-falla-a-mitad-de-ejecución)
5. [Comportamiento de transacciones TypeORM en PostgreSQL](#5-comportamiento-de-transacciones-typeorm-en-postgresql)
6. [Catálogo de seguridad de migraciones](#6-catálogo-de-seguridad-de-migraciones)
7. [Requisitos de aprobación para migraciones destructivas](#7-requisitos-de-aprobación-para-migraciones-destructivas)
8. [Ventanas de consistencia eventual conocidas](#8-ventanas-de-consistencia-eventual-conocidas)

---

## 1. Lista de verificación pre-despliegue

Completar cada ítem antes de ejecutar migraciones contra una base de datos de producción (o staging).

- [ ] **Snapshot completo de la base de datos tomado** — usar el botón "Create backup" de Railway, `pg_dump`, o la restauración a punto en el tiempo del proveedor cloud. Etiquetar el backup con el tag del despliegue (ej. `pre-deploy-v1.4.0-2026-05-25`). Verificar que el dump es restaurable antes de continuar.
- [ ] **Revisar la lista de migraciones pendientes** — ejecutar `npm run migration:show` (o `typeorm migration:show`) en cada servicio afectado y comparar la salida con el [catálogo de seguridad](#6-catálogo-de-seguridad-de-migraciones) más abajo.
- [ ] **Marcar migraciones destructivas** — si alguna migración pendiente está clasificada como **DESTRUCTIVA** o **CONDICIONAL**, obtener aprobación escrita explícita del líder técnico antes de desplegar (ver [sección 7](#7-requisitos-de-aprobación-para-migraciones-destructivas)).
- [ ] **Confirmar viabilidad del rollback** — para cada migración pendiente, verificar si `down()` es seguro. Si no lo es, decidir de antemano cuál será el plan de contingencia (restauración de snapshot vs. reparación manual de datos).
- [ ] **Anunciar la ventana de despliegue** — notificar al equipo la hora de inicio y el tiempo de inactividad esperado, si lo hubiera.

---

## 2. Ejecutar migraciones en producción

Cada servicio expone un script npm `migration:run` que envuelve `typeorm migration:run`. Railway lo ejecuta automáticamente al desplegar a través del comando de inicio del `Dockerfile`. Para ejecución manual:

```bash
# Dentro del directorio del servicio
npm run migration:run
```

Para despliegues en Railway, las migraciones se ejecutan como parte de la secuencia de inicio del contenedor. Si necesitas ejecutarlas manualmente:

```bash
railway run --service <nombre-del-servicio> npm run migration:run
```

**Nunca ejecutar `migration:run` directamente contra producción mientras el servicio está recibiendo tráfico**, a menos que la migración sea segura en línea (columnas/índices aditivos que toleran lecturas/escrituras concurrentes).

---

## 3. Ventana de rollback y procedimiento

### Regla de los 3 minutos

Si se detecta un fallo en el despliegue **dentro de los 3 minutos** de que la migración se completó y el nuevo código no ha escrito datos:

1. Detener o redesplegar la imagen anterior del servicio inmediatamente.
2. Ejecutar el comando de reversión:
   ```bash
   npm run migration:revert   # revierte la última migración aplicada
   ```
3. Verificar el estado de la base de datos con una inspección puntual de las tablas afectadas.
4. Re-ejecutar el despliegue exitoso anterior.

> **Advertencia:** `migration:revert` solo revierte la migración *más recientemente aplicada*. Para revertir múltiples migraciones, ejecutar el comando una vez por migración en orden inverso.

### Cuándo `migration:revert` NO es seguro

**No** ejecutar `migration:revert` si la migración pendiente está clasificada como **DESTRUCTIVA** o **CON PÉRDIDA** (ver catálogo). En esos casos la función `down()` lanza un error o causa pérdida permanente de datos. Usar el **camino de restauración de snapshot** en su lugar:

1. Detener todo el tráfico al servicio afectado (establecer el servicio Railway en 0 réplicas o activar el modo mantenimiento vía Kong).
2. Restaurar el snapshot pre-despliegue en una nueva instancia de base de datos.
3. Actualizar las variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME` y `DB_PASSWORD` del servicio para apuntar a la instancia restaurada (en Railway: desconectar el plugin Postgres actual y conectar el nuevo, o actualizar las variables manualmente).
4. Redesplegar la imagen anterior del servicio.
5. Validar la integridad de los datos antes de re-habilitar el tráfico.
6. Programar un post-mortem para corregir el `down()` de la migración antes del próximo intento.

---

## 4. Contingencia — migración falla a mitad de ejecución

TypeORM envuelve cada migración en una transacción PostgreSQL por defecto (ver [sección 5](#5-comportamiento-de-transacciones-typeorm-en-postgresql)). Si la migración lanza una excepción en cualquier punto:

- PostgreSQL **revierte automáticamente toda la migración** — no quedan cambios parciales de esquema.
- La migración queda marcada como no aplicada en la tabla `migrations`.
- El servicio fallará al iniciar (`migrationsRun: true` en TypeORM causa abort en el arranque ante un fallo).

**Pasos de recuperación ante una migración fallida:**

1. Leer el output del error cuidadosamente — `typeorm` registra la sentencia SQL fallida.
2. Corregir el archivo fuente de la migración (o el problema de datos subyacente) en una rama de feature.
3. Re-ejecutar la lista de verificación pre-despliegue.
4. Re-desplegar.

> **Excepción:** Las migraciones que usan `transaction: false` (opt-out, poco frecuente) NO son atómicas. Si dicha migración falla a mitad de camino, se requiere reparación manual. Verificar el archivo de migración por `transaction: false` antes de desplegar.

---

## 5. Comportamiento de transacciones TypeORM en PostgreSQL

- Por defecto, TypeORM envuelve cada ejecución de `up()` y `down()` en una única transacción DDL.
- PostgreSQL soporta DDL transaccional (`CREATE TABLE`, `ALTER TABLE`, `DROP INDEX`, etc.), por lo que un fallo en cualquier paso revierte toda la migración.
- **Excepción: `CREATE INDEX CONCURRENTLY` y `DROP INDEX CONCURRENTLY`** no pueden ejecutarse dentro de una transacción. Cualquier migración que use estos comandos debe establecer `transaction: false` y por tanto **no es atómica**.
- Si una migración debe ser no-transaccional, documentarlo explícitamente en el archivo de migración con un comentario y actualizar el catálogo a continuación.

---

## 6. Catálogo de seguridad de migraciones

### Leyenda de clasificación

| Etiqueta | Significado |
|---|---|
| ✅ SEGURA | `down()` es un inverso limpio; `migration:revert` es seguro |
| ⚠️ CONDICIONAL | `down()` puede fallar en tiempo de ejecución según el estado actual de los datos |
| ❌ DESTRUCTIVA | `down()` destruye datos permanentemente o no restaura lo que `up()` eliminó |
| ❌ CON PÉRDIDA | `down()` restaura parcialmente los datos; información se pierde permanentemente |
| 🔒 DOWN VACÍO | `down()` está vacío intencionalmente — PostgreSQL no puede eliminar valores de un enum sin recrear el tipo. El valor permanece en el esquema al revertir pero no causa daño |

---

### Migraciones de auth-service

| Migración | Descripción | Seguridad de rollback |
|---|---|---|
| `1700000000000-InitialSchema` | Crea la tabla `credentials` con email, hash de contraseña y estado | ✅ SEGURA — `down()` elimina la tabla limpiamente |
| `1700000000001-DropRefreshTokenHash` | Elimina la columna `refresh_token_hash` (reemplazada por refresh tokens basados en Redis) | ❌ DESTRUCTIVA — `down()` re-agrega la columna como TEXT nullable; los datos originales del hash se pierden permanentemente |
| `1776900000000-AddCredentialSoftDelete` | Agrega `deleted_at` a `credentials`; reemplaza la restricción global de email único con un índice parcial sobre filas activas | ⚠️ CONDICIONAL — `down()` aborta si credenciales eliminadas (soft-delete) comparten un email con una fila activa (violaría la restricción global que se está restaurando). Verificar que no existan duplicados de email entre filas activas y eliminadas antes de revertir |

---

### Migraciones de user-service

| Migración | Descripción | Seguridad de rollback |
|---|---|---|
| `1700000000000-InitialSchema` | Crea las tablas base: `users`, `roles`, `permissions`, `user_org_roles` | ✅ SEGURA — `down()` elimina todas las tablas limpiamente |
| `1741451800000-AddSystemRoleNameUniqueIndex` | Agrega un índice único parcial sobre nombres de roles de sistema | ✅ SEGURA — `down()` elimina el índice limpiamente |
| `1772994203515-ReplaceEmailIndexWithPartialIndex` | Reemplaza la restricción global de unicidad de email con un índice parcial (solo usuarios activos) | ⚠️ CONDICIONAL — `down()` lanza error si usuarios eliminados (soft-delete) comparten email con un usuario activo. Verificar que no existan duplicados antes de revertir |
| `1773120000000-SeedPermissionsAndSystemRoles` | Siembra todos los permisos y roles de sistema | ❌ DESTRUCTIVA — `down()` ejecuta `DELETE FROM permissions` y `DELETE FROM system_roles`, eliminando toda la base RBAC. No usar `migration:revert`; restaurar desde snapshot |
| `1773824671815-AddRegistrationStatusToUsers` | Agrega la columna enum `registration_status` a `users` | ✅ SEGURA — columna aditiva; `down()` la elimina y restaura el default de `is_active` |
| `1774692345732-DeleteSuperAdminRole` | Elimina la fila de rol `SUPER_ADMIN` legacy y sus vínculos de permisos | ❌ DESTRUCTIVA — `down()` solo recrea el valor del enum; las filas de rol eliminadas y sus asociaciones de permisos no se restauran |
| `1775000000000-AddSoftDeleteToUserOrgRoles` | Agrega la columna `deleted_at` a `user_org_roles` | ✅ SEGURA — columna aditiva; `down()` la elimina limpiamente |
| `1775186318602-MakeRoleIdNullableInUserOrgRoles` | Hace nullable `role_id` en `user_org_roles` | ❌ DESTRUCTIVA — `down()` elimina todas las filas donde `role_id IS NULL` antes de restaurar NOT NULL. Usuarios sin asignación de rol pierden permanentemente su registro de membresía en la org |
| `1775500000000-AddOrgStructureFieldsToUsers` | Agrega columnas `department_id`, `area_id`, `position_id` a `users` | ✅ SEGURA — columnas nullable aditivas; `down()` las elimina limpiamente |
| `1775500001000-MakePositionNullable` | Hace nullable el campo `position` | ✅ SEGURA — `down()` restaura NOT NULL con un valor por defecto |
| `1775600000000-AddOrgStructureEnumValue` | Agrega el valor `ORG_STRUCTURE` al enum de módulos de permisos | 🔒 DOWN VACÍO — PostgreSQL no puede eliminar valores de enum; la etiqueta es inofensiva una vez que la migración hermana `1775600000001` elimina las filas dependientes en su `down()` |
| `1775600000001-SeedOrgStructurePermissions` | Siembra los permisos `ORG_STRUCTURE` y los vincula a roles | ✅ SEGURA — `down()` elimina las filas sembradas limpiamente |
| `1775700000000-AddAvatarUrlToUsers` | Agrega la columna `avatar_url` a `users` | ✅ SEGURA — columna nullable aditiva; `down()` la elimina limpiamente |
| `1775800000000-AddRemovedAtToUserOrgRoles` | Agrega timestamp `removed_at` a `user_org_roles` | ✅ SEGURA — columna nullable aditiva; `down()` la elimina limpiamente |
| `1775900000000-AddWorkflowsManagePermission` | Siembra el permiso `WORKFLOWS:MANAGE` y lo vincula al rol ADMIN | ✅ SEGURA — `down()` elimina las filas sembradas limpiamente |
| `1776000000000-AddIsOptionalReviewerToUsers` | Agrega la columna `is_optional_reviewer` a `users` (luego movida a `user_org_roles`) | ✅ SEGURA — columna aditiva; `down()` la elimina limpiamente |
| `1776100000000-MoveIsOptionalReviewerToUserOrgRoles` | Mueve `is_optional_reviewer` de `users` a `user_org_roles` (granularidad por org) | ✅ SEGURA — `down()` usa `BOOL_OR` para restaurar el flag global en `users` antes de eliminar la columna por org; los datos se preservan |
| `1776200000000-AddCompositeIndexOrgIdUserIdOnUserOrgRoles` | Agrega índice compuesto `(org_id, user_id)` en `user_org_roles` | ✅ SEGURA — `down()` elimina el índice limpiamente |
| `1776300000000-AddWorkflowWriteApproveToEditor` | Siembra los permisos `WORKFLOWS:WRITE` y `WORKFLOWS:APPROVE` para el rol EDITOR | ✅ SEGURA — `down()` elimina las filas sembradas limpiamente |
| `1776400000000-CleanupUnusedPermissions` | Elimina los permisos en desuso `DOCUMENTS:READ` y `ORGS:MANAGE` y sus vínculos a roles | ✅ SEGURA — `down()` restaura las filas eliminadas con sus UUIDs originales vía tabla de backup |
| `1776500000000-AddAuditorRole` | Crea el rol de sistema `AUDITOR` con `AUDIT:READ`; mueve `AUDIT:READ` fuera del rol `VIEWER` | ✅ SEGURA — `down()` restaura `AUDIT:READ` en `VIEWER` y elimina el rol `AUDITOR` |
| `1776600000000-RemoveSuperAdminRole` | Elimina `SUPER_ADMIN` del enum de roles y limpia los datos relacionados | ❌ DESTRUCTIVA — `down()` restaura el valor del enum y la fila del rol pero explícitamente **no restaura** las asignaciones en `user_org_roles`. Cualquier usuario que tuviese este rol lo pierde permanentemente |
| `1776700000000-AddUsersReadToEditor` | Siembra el permiso `USERS:READ` para el rol EDITOR | ✅ SEGURA — `down()` elimina la fila sembrada limpiamente |
| `1776700000000-RenameOrgsPermissionToRoles` | Renombra el módulo de permiso `ORGS` a `ROLES` en todas las filas | ⚠️ CONDICIONAL — `down()` realiza el renombramiento inverso; seguro solo si no se agregaron nuevos permisos `ROLES` después de que `up()` se ejecutó |
| `1776800000000-DropTwoFactorEnabled` | Elimina la columna booleana `two_factor_enabled` en desuso de `users` | ⚠️ CONDICIONAL — `down()` re-agrega la columna como `NOT NULL DEFAULT false`; los valores originales (siempre `false`) no se almacenan, pero es aceptable dado que la columna nunca fue utilizada |

---

### Migraciones de org-service

| Migración | Descripción | Seguridad de rollback |
|---|---|---|
| `1747000000000-CreateOrgs` | Crea la tabla `orgs` (esquema inicial) | ✅ SEGURA — `down()` elimina la tabla limpiamente |
| `1775300000000-CreateOrgStructure` | Crea las tablas `departamentos`, `areas`, `cargos` | ✅ SEGURA — `down()` elimina las tres tablas limpiamente |
| `1775400000000-MakeCargoAreaNullable` | Hace nullable `area_id` en `cargos` para permitir cargos a nivel de departamento | ⚠️ CONDICIONAL — `down()` aborta si existe algún cargo con `area_id IS NULL`; esas filas violarían la restricción NOT NULL que se está restaurando |
| `1775500000000-AddOrgSearchTrigram` | Agrega índices trigram de pg_trgm en `orgs.name` y `orgs.nit` usando `CREATE INDEX CONCURRENTLY` | ✅ SEGURA — `down()` elimina ambos índices con `DROP INDEX CONCURRENTLY`. **Nota:** esta migración usa `transaction: false` — si falla a mitad de ejecución NO es atómica y puede requerir limpieza manual de índices |

---

### Migraciones de workflow-service

| Migración | Descripción | Seguridad de rollback |
|---|---|---|
| `1714300000000-InitialWorkflowSchema` | Crea todas las tablas de workflow: `workflows`, `workflow_approval_steps`, `workflow_approval_actions`, `workflow_timeline`, etc. | ✅ SEGURA — `down()` elimina todas las tablas en orden inverso de dependencia |
| `1746500000000-AddApprovalActionAttachment` | Agrega una tabla separada `workflow_approval_attachments` (reemplazada por `1746600000000`) | ✅ SEGURA — `down()` elimina la tabla limpiamente |
| `1746600000000-ReplaceApprovalActionAttachmentsWithJsonb` | Reemplaza la tabla de adjuntos con una columna `jsonb` en `approval_actions`; migra filas existentes | ❌ CON PÉRDIDA — `down()` restaura solo el **primer** adjunto por acción. Los adjuntos múltiples por acción se pierden permanentemente. No usar `migration:revert`; restaurar desde snapshot |
| `1747000000000-AddPendingReviewCycleStatus` | Agrega `PENDING_REVIEW_CYCLE` al enum de estado de workflow | 🔒 DOWN VACÍO — el valor del enum no puede eliminarse; permanece en el esquema pero no causa daño |
| `1747100000000-FixApprovalActionsCascade` | Corrige el cascade FK en `workflow_approval_actions.step_id` a `ON DELETE CASCADE` | ✅ SEGURA — `down()` restaura la restricción FK anterior |
| `1748200000000-AddRejectedWorkflowStatus` | Agrega `REJECTED` al enum de estado de workflow | 🔒 DOWN VACÍO — el valor del enum no puede eliminarse; permanece en el esquema pero no causa daño |
| `1748300000000-AddOptionalReviewers` | Agrega columnas `optional_reviewers jsonb` y relacionadas a las tablas de workflow | ✅ SEGURA — columnas aditivas; `down()` las elimina limpiamente |
| `1776100000000-AddIdempotencyKeys` | Crea la tabla `idempotency_keys` para protección contra requests duplicados | ✅ SEGURA — `down()` elimina la tabla limpiamente |
| `1776200000000-AddWorkflowUpdatedTimelineEvent` | Agrega `WORKFLOW_UPDATED` al enum `timeline_event_type_enum` | 🔒 DOWN VACÍO — el valor del enum no puede eliminarse; permanece en el esquema pero no causa daño |

---

### Migraciones de notification-service

| Migración | Descripción | Seguridad de rollback |
|---|---|---|
| `1748000000000-InitialSchema` | Crea la tabla `notifications` | ✅ SEGURA — `down()` elimina la tabla limpiamente |
| `1748100000000-AddOrgToNotifications` | Agrega columnas `org_id` y `org_name` más índice a `notifications` | ✅ SEGURA — columnas aditivas; `down()` elimina ambas columnas y el índice limpiamente |

---

### document-service / audit-service / metadata-extractor-service

Estos servicios usan MongoDB (document-service) y Elasticsearch (audit-service) — ninguno usa migraciones TypeORM. Los cambios de esquema son manejados por la capa de aplicación al arrancar. No aplica catálogo de migraciones PostgreSQL.

---

## 7. Requisitos de aprobación para migraciones destructivas

Cualquier migración clasificada como **❌ DESTRUCTIVA** o **❌ CON PÉRDIDA** requiere:

1. **Aprobación escrita** del líder técnico en la descripción del PR antes de hacer merge.
2. **Snapshot obligatorio** tomado inmediatamente antes de que se abra la ventana de despliegue (no antes, para minimizar el delta de datos).
3. **Un script de reparación de datos** commiteado junto a la migración que pueda recrear los datos perdidos desde otras fuentes (logs de auditoría, S3, etc.) en caso de rollback de emergencia vía restauración de snapshot.
4. **Plan de rollback explícito** documentado en el PR — específicamente, el camino para restaurar el servicio si el despliegue se revierte dentro de la ventana.

Para las migraciones destructivas actualmente catalogadas, la estrategia práctica de rollback es **restauración de snapshot únicamente**. No debe usarse `migration:revert` para:

- `1774692345732-DeleteSuperAdminRole`
- `1773120000000-SeedPermissionsAndSystemRoles`
- `1746600000000-ReplaceApprovalActionAttachmentsWithJsonb`
- `1776600000000-RemoveSuperAdminRole`
- `1775186318602-MakeRoleIdNullableInUserOrgRoles`
- `1700000000001-DropRefreshTokenHash`

---

## 8. Ventanas de consistencia eventual conocidas

Esta sección cataloga las operaciones entre servicios donde un fallo a mitad de secuencia puede dejar los datos en un estado inconsistente entre dos bases de datos independientes. Cada entrada describe el riesgo, la mitigación actual y el procedimiento de recuperación manual.

---

### 8.1 Soft-delete de usuario → deshabilitar credencial (user-service → auth-service)

**Servicios involucrados:** user-service (PostgreSQL `user_db`), auth-service (PostgreSQL `auth_db`)

**Secuencia de operación:**

```text
1. user-service: softRemove(user)                        → user.deleted_at = NOW()
2. user-service: authClient.disableCredentials(userId)   → PATCH /auth/credentials/:id/disable
```

**Ventana de fallo:** Si el paso 2 falla después de que el paso 1 se completó, el registro del usuario queda eliminado (soft-delete) pero las credenciales permanecen `ACTIVE`. El usuario puede seguir iniciando sesión hasta que la credencial se deshabilite manualmente o expire su refresh token.

**Mitigación actual:**
- `AuthClientService.internalPatch` reintenta hasta **2 veces** (3 intentos totales) con backoff exponencial (500 ms, 1.000 ms) antes de propagar el error.
- Si todos los reintentos fallan, la respuesta HTTP al administrador devuelve un error, indicando un reintento manual.
- Como `disableCredentials` es **idempotente**, reintentar la operación completa `DELETE /api/v1/users/:id` desde la UI de administración es seguro.

**Recuperación manual (si se detecta la inconsistencia):**

```bash
# 1. Identificar el userId afectado desde los logs de user-service (correlationId) o consulta a BD
# 2. Llamar directamente a auth-service para deshabilitar la credencial:
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/disable \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"

# 3. Opcionalmente revocar todos los refresh tokens activos:
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/revoke-tokens \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"
```

**Consulta de detección (auth_db):**

```sql
-- Credenciales que siguen ACTIVE pero cuyo userId no aparece en user_db.users
-- Ejecutar después de exportar la lista de userIds eliminados desde user_db:
SELECT id, email, user_id, status
FROM credentials
WHERE status = 'active'
  AND user_id IN ('<userId1>', '<userId2>');  -- pegar lista desde consulta en user_db
```

**Horizonte de consistencia:** Como máximo la duración de la ventana de reintentos (~1,5 s) más el TTL restante de cualquier access token activo (`JWT_EXPIRATION`, por defecto 1 h). Después de ese período el usuario no puede iniciar nuevas sesiones.

---

### 8.2 Restauración de usuario → habilitar credencial (user-service → auth-service)

Misma topología que 8.1 pero en sentido inverso. Si `enableCredentials` falla después de `usersRepository.restore`, el registro del usuario queda activo pero la credencial permanece `DISABLED`.

**Recuperación manual:**

```bash
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/enable \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"
```
