# Migration Runbook — Document Management System

> **Audience:** Backend engineers and DevOps performing production deployments that include TypeORM migrations.
> **Scope:** PostgreSQL databases for all services (user-service, workflow-service, auth-service, org-service, document-service, audit-service, notification-service, metadata-extractor-service).

---

## Table of Contents

1. [Pre-deployment checklist](#1-pre-deployment-checklist)
2. [Running migrations in production](#2-running-migrations-in-production)
3. [Rollback window and procedure](#3-rollback-window-and-procedure)
4. [Contingency — migration fails mid-execution](#4-contingency--migration-fails-mid-execution)
5. [TypeORM transaction behaviour in PostgreSQL](#5-typeorm-transaction-behaviour-in-postgresql)
6. [Migration safety catalogue](#6-migration-safety-catalogue)
7. [Approval requirements for destructive migrations](#7-approval-requirements-for-destructive-migrations)
8. [Known eventual-consistency windows](#8-known-eventual-consistency-windows)

---

## 1. Pre-deployment checklist

Complete every item before running migrations against a production (or staging) database.

- [ ] **Full database snapshot taken** — use Railway's "Create backup" button, `pg_dump`, or your cloud provider's point-in-time restore. Label the backup with the deployment tag (e.g. `pre-deploy-v1.4.0-2026-05-25`). Verify the dump is restorable before proceeding.
- [ ] **Review the pending migration list** — run `npm run migration:show` (or `typeorm migration:show`) in each affected service and compare the output with the [safety catalogue](#6-migration-safety-catalogue) below.
- [ ] **Flag destructive migrations** — if any pending migration is classified **DESTRUCTIVE** or **CONDITIONAL**, obtain explicit written approval from the team lead before deploying (see [section 7](#7-approval-requirements-for-destructive-migrations)).
- [ ] **Confirm rollback feasibility** — for every pending migration, check whether `down()` is safe. If it is not, decide in advance what the contingency will be (snapshot restore vs. manual data repair).
- [ ] **Announce deployment window** — notify the team of the start time and expected downtime, if any.

---

## 2. Running migrations in production

Each service exposes a `migration:run` npm script that wraps `typeorm migration:run`. Railway executes this automatically on deploy via the service `Dockerfile` start command. For manual execution:

```bash
# Inside the service directory
npm run migration:run
```

For Railway deployments, migrations run as part of the container start sequence. If you need to run them manually:

```bash
railway run --service <service-name> npm run migration:run
```

**Never run `migration:run` directly against production while the service is receiving traffic** unless the migration is online-safe (additive columns/indexes that tolerate concurrent reads/writes).

---

## 3. Rollback window and procedure

### 3-minute rule

If a deployment failure is detected **within 3 minutes** of the migration completing and no data has been written by the new code:

1. Stop or redeploy the previous service image immediately.
2. Run the revert command:
   ```bash
   npm run migration:revert   # reverts the last applied migration
   ```
3. Verify the database state with a spot check on the affected tables.
4. Re-run the previous successful deployment.

> **Warning:** `migration:revert` only reverts the *most recently applied* migration. To revert multiple migrations, run the command once per migration in reverse order.

### When `migration:revert` is NOT safe

Do **not** run `migration:revert` if the pending migration is classified **DESTRUCTIVE** or **LOSSY** (see catalogue). In those cases the `down()` function either throws an error or causes permanent data loss. Use the **snapshot restore path** instead:

1. Halt all traffic to the affected service (set Railway service to 0 replicas or enable maintenance mode via Kong).
2. Restore the pre-deployment database snapshot to a new database instance.
3. Update the service's `DATABASE_URL` environment variable to point to the restored instance.
4. Redeploy the previous service image.
5. Validate data integrity before re-enabling traffic.
6. Schedule a post-mortem to fix the migration's `down()` before the next attempt.

---

## 4. Contingency — migration fails mid-execution

TypeORM wraps each migration in a PostgreSQL transaction by default (see [section 5](#5-typeorm-transaction-behaviour-in-postgresql)). If the migration throws at any point:

- PostgreSQL **rolls back the entire migration automatically** — no partial schema changes remain.
- The migration is marked as not applied in the `migrations` table.
- The service will fail to start (TypeORM's `migrationsRun: true` option causes startup abort on failure).

**Recovery steps for a failed migration:**

1. Read the error output carefully — `typeorm` logs the failing SQL statement.
2. Fix the migration source file (or the underlying data issue) in a feature branch.
3. Re-run the pre-deployment checklist.
4. Re-deploy.

> **Exception:** Migrations that use `transaction: false` (opt-out, rare) are NOT atomic. If such a migration fails mid-way, manual repair is required. Check the migration file for `transaction: false` before deploying.

---

## 5. TypeORM transaction behaviour in PostgreSQL

- By default, TypeORM wraps every `up()` and `down()` execution in a single DDL transaction.
- PostgreSQL supports transactional DDL (`CREATE TABLE`, `ALTER TABLE`, `DROP INDEX`, etc.), so a failure at any step rolls back the entire migration.
- **Exception: `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY`** cannot run inside a transaction. Any migration that uses these must set `transaction: false` and is therefore **not atomic**.
- If a migration must be non-transactional, document it explicitly in the migration file with a comment and update the catalogue below.

---

## 6. Migration safety catalogue

### Classification legend

| Label | Meaning |
|---|---|
| ✅ SAFE | `down()` is a clean inverse; `migration:revert` is safe |
| ⚠️ CONDITIONAL | `down()` may fail at runtime depending on current data state |
| ❌ DESTRUCTIVE | `down()` permanently destroys data or does not restore what `up()` deleted |
| ❌ LOSSY | `down()` partially restores data; information is permanently lost |

---

### user-service migrations

| Migration | Description | Rollback safety |
|---|---|---|
| `1741451800000-AddSystemRoleNameUniqueIndex` | Adds a partial unique index on system role names | ✅ SAFE — `down()` drops the index cleanly |
| `1772994203515-ReplaceEmailIndexWithPartialIndex` | Replaces the global email uniqueness constraint with a partial index (active users only) | ⚠️ CONDITIONAL — `down()` throws `Error('Cannot restore global email uniqueness while duplicate emails exist')` if soft-deleted users share an email with an active user. Verify no such duplicates before reverting. |
| `1773120000000-SeedPermissionsAndSystemRoles` | Seeds all permissions and system roles (ADMIN, EMPLOYEE, etc.) | ❌ DESTRUCTIVE — `down()` issues `DELETE FROM permissions` and `DELETE FROM system_roles` wiping all seeded data. Reverting effectively destroys the RBAC baseline. Do NOT revert; restore from snapshot instead. |
| `1774692345732-DeleteSuperAdminRole` | Removes the legacy `SUPER_ADMIN` role row and its permission bindings | ❌ DESTRUCTIVE — `down()` only recreates the enum type variant; it does **not** reinsert the deleted role rows or permission associations. The role data is permanently gone after `up()` runs. |
| `1775900000000-AddWorkflowsManagePermission` | Seeds the `workflow:manage` permission and binds it to ADMIN role | ✅ SAFE — `down()` cleanly deletes the seeded rows |
| `1776000000000-AddIsOptionalReviewerToUsers` | Adds `isOptionalReviewer boolean` column to `users` table | ✅ SAFE — additive column; `down()` drops it cleanly |

---

### workflow-service migrations

| Migration | Description | Rollback safety |
|---|---|---|
| `1746600000000-ReplaceApprovalActionAttachmentsWithJsonb` | Replaces a separate attachments table with a `jsonb` column on `approval_actions`; migrates existing rows | ❌ LOSSY — `down()` restores only the **first** attachment per action. If any action had multiple attachments, all but the first are permanently lost after `up()` runs. Do NOT revert; restore from snapshot instead. |
| `1748300000000-AddOptionalReviewers` | Adds `optionalReviewers jsonb` and related columns to workflow tables | ✅ SAFE — additive columns; `down()` drops them cleanly |
| `1776100000000-AddIdempotencyKeys` | Creates the `idempotency_keys` table for duplicate-request protection | ✅ SAFE — `down()` drops the table cleanly |

---

### auth-service / org-service / document-service / audit-service / notification-service / metadata-extractor-service

No custom migrations are tracked at the time of this writing. Update this section when migrations are added to those services.

---

## 7. Approval requirements for destructive migrations

Any migration classified **❌ DESTRUCTIVE** or **❌ LOSSY** requires:

1. **Written approval** from the team lead in the PR description before merging.
2. **Mandatory snapshot** taken immediately before the deployment window opens (not earlier, to minimise data delta).
3. **A data-repair script** committed alongside the migration that can recreate the lost data from other sources (audit logs, S3, etc.) in the event of an emergency rollback via snapshot restore.
4. **Explicit rollback plan** documented in the PR — specifically, the path to restore service if the deployment is rolled back within the window.

For the currently catalogued destructive migrations, the practical rollback strategy is **snapshot restore only**. `migration:revert` must not be used for:

- `1774692345732-DeleteSuperAdminRole`
- `1773120000000-SeedPermissionsAndSystemRoles`
- `1746600000000-ReplaceApprovalActionAttachmentsWithJsonb`

---

## 8. Known eventual-consistency windows

This section catalogues cross-service operations where a failure mid-sequence can leave data in an inconsistent state between two independent databases. Each entry describes the risk, the current mitigation, and the manual recovery procedure.

---

### 8.1 User soft-delete → credential disable (user-service → auth-service)

**Services involved:** user-service (PostgreSQL `user_db`), auth-service (PostgreSQL `auth_db`)

**Operation sequence:**

```text
1. user-service: softRemove(user)       → user.deleted_at = NOW()
2. user-service: authClient.disableCredentials(userId) → PATCH /auth/credentials/:id/disable
```

**Failure window:** If step 2 fails after step 1 completes, the user record is soft-deleted but credentials remain `ACTIVE`. The user can still log in until the credential is manually disabled or their refresh token expires.

**Current mitigation:**
- `AuthClientService.internalPatch` retries up to **2 times** (3 total attempts) with exponential backoff (500 ms, 1 000 ms) before propagating the error.
- If all retries fail, the HTTP response to the admin returns an error, prompting a manual retry.
- Since `disableCredentials` is **idempotent**, retrying the full `DELETE /api/v1/users/:id` operation from the admin UI is safe.

**Manual recovery (if inconsistency is discovered):**

```bash
# 1. Identify the affected userId from user-service logs (correlationId) or DB query
# 2. Call auth-service directly to disable the credential:
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/disable \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"

# 3. Optionally revoke all active refresh tokens:
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/revoke-tokens \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"
```

**Detection query (auth_db):**

```sql
-- Credentials that are still ACTIVE but whose userId does not appear in user_db.users
-- Run after exporting the list of soft-deleted userIds from user_db:
SELECT id, email, user_id, status
FROM credentials
WHERE status = 'active'
  AND user_id IN ('<userId1>', '<userId2>');  -- paste list from user_db query
```

**Consistency horizon:** At most the duration of the retry window (~1.5 s) plus the remaining TTL of any active access token (`JWT_EXPIRATION`, default 1 h). After that the user cannot issue new sessions.

---

### 8.2 User restore → credential enable (user-service → auth-service)

Same topology as 8.1 but in reverse. If `enableCredentials` fails after `usersRepository.restore`, the user record is active but the credential stays `DISABLED`.

**Manual recovery:**

```bash
curl -X PATCH https://<auth-service-url>/api/v1/auth/credentials/<userId>/enable \
  -H "x-internal-token: <INTERNAL_TOKEN_USER_AUTH>"
```
