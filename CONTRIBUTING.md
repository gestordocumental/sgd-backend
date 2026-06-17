# Guía de contribución — SGD Backend

Todo lo necesario para que un desarrollador nuevo pueda levantar el entorno, correr las pruebas y enviar su primer PR sin necesitar ayuda.

---

## Índice

1. [Prerequisitos](#1-prerequisitos)
2. [Instalación inicial](#2-instalación-inicial)
3. [Levantar la infraestructura local](#3-levantar-la-infraestructura-local)
4. [Configurar variables de entorno](#4-configurar-variables-de-entorno)
5. [Ejecutar un servicio](#5-ejecutar-un-servicio)
6. [Pruebas](#6-pruebas)
7. [Convenciones de código](#7-convenciones-de-código)
8. [Flujo de ramas y PRs](#8-flujo-de-ramas-y-prs)
9. [Migraciones de base de datos](#9-migraciones-de-base-de-datos)
10. [Agregar un nuevo servicio](#10-agregar-un-nuevo-servicio)
11. [Qué valida el CI](#11-qué-valida-el-ci)
12. [Problemas frecuentes](#12-problemas-frecuentes)

---

## 1. Prerequisitos

| Herramienta | Versión mínima | Verificar |
|---|---|---|
| Node.js | 20 LTS | `node -v` |
| npm | 10+ (incluido con Node 20) | `npm -v` |
| Docker + Docker Compose | 24+ / 2.20+ | `docker compose version` |
| Git | cualquier reciente | `git --version` |

No es necesario instalar TypeScript ni NestJS CLI globalmente — están en las devDependencies del workspace.

---

## 2. Instalación inicial

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd document-management-system

# 2. Instalar TODAS las dependencias del monorepo desde la raíz
#    Esto enlaza @sgd/common como workspace local en todos los servicios
npm ci

# 3. Compilar el paquete común (REQUERIDO antes de correr cualquier servicio)
#    Los servicios importan desde packages/common/dist/ — sin este paso ts-jest
#    lanza TS2307 y el servidor NestJS no arranca
npm run build:common
```

> Si agregas o modificas código en `packages/common`, vuelve a ejecutar `npm run build:common` para que los servicios vean los cambios compilados. En desarrollo activo, usa `npm run build:common:watch` en una terminal aparte.

---

## 3. Levantar la infraestructura local

El archivo `docker-compose.yml` en la raíz levanta toda la infraestructura necesaria:

```bash
docker compose up -d
```

Esto inicia:

| Servicio | Puerto local | Usado por |
|---|---|---|
| PostgreSQL | 5432 | auth, user, org, workflow, notification |
| Redis | 6379 | auth, user, notification |
| MongoDB | 27017 | document-service |
| Kafka (KRaft) | 9092 | todos los servicios |
| Elasticsearch | 9200 | audit-service |
| MinIO (S3 local) | 9000 / 9001 | document-service, metadata-extractor-service |

Las bases de datos de PostgreSQL se crean automáticamente al primer arranque mediante el servicio `postgres-init` incluido en el compose.

Para detener todo:
```bash
docker compose down
```

Para detener y borrar los volúmenes (reset completo):
```bash
docker compose down -v
```

---

## 4. Configurar variables de entorno

Cada servicio tiene su propio `.env.example`. Copia y ajusta antes de arrancar:

```bash
# Ejemplo para auth-service
cp services/auth-service/.env.example services/auth-service/.env
```

Repite para cada servicio que vayas a levantar. Los valores del `.env.example` están listos para funcionar con el `docker-compose.yml` local sin modificaciones — solo necesitas copiar el archivo.

Consulta el `README.md` principal para ver la lista completa de variables de cada servicio con sus valores locales de ejemplo.

---

## 5. Ejecutar un servicio

Desde la carpeta de cada servicio:

```bash
cd services/auth-service

# Modo desarrollo (watch — recarga automática)
npm run start:dev

# Modo debug (inspector en el puerto del servicio)
npm run start:debug

# Producción (requiere haber hecho npm run build antes)
npm run start:prod
```

Cada servicio escucha en el puerto definido en su `.env` (por defecto `PORT=3000`). Si levantas varios servicios a la vez, asegúrate de que cada uno use un puerto diferente.

---

## 6. Pruebas

### 6.1 Tests unitarios

```bash
# Correr los tests de un servicio específico
cd services/auth-service
npm test

# Con modo watch (re-ejecuta al guardar)
npm run test:watch

# Con cobertura (umbral mínimo: 85% de statements y lines)
npm run test:cov
```

El CI requiere que `test:cov` pase. Si tu PR baja la cobertura por debajo del 85%, el CI falla.

### 6.2 Tests de integración (auth-service)

Los tests de integración levantan transacciones reales contra PostgreSQL y Redis. No necesitan los servicios NestJS corriendo — usan la infraestructura local directamente.

```bash
# Asegúrate de que docker compose esté corriendo
docker compose up -d postgresql redis

cd services/auth-service

# Configurar variables (la BD de test es distinta a la de desarrollo)
export TEST_PG_HOST=localhost
export TEST_PG_PORT=5432
export TEST_PG_USERNAME=auth_user
export TEST_PG_PASSWORD=auth_pass_local
export TEST_PG_DATABASE=auth_db
export TEST_REDIS_HOST=localhost
export TEST_REDIS_PORT=6379

npm run test:int
```

Los tests de integración corren con `--runInBand` (secuencial) y tienen timeout de 60 segundos por test.

### 6.3 Tests de contrato Pact (auth-service ↔ user-service)

Los contract tests verifican que la interfaz entre auth-service y user-service es compatible. Se ejecutan en dos fases:

```bash
# Fase 1 — Consumer: genera los archivos pact JSON
cd services/auth-service
npm run test:pact:consumer

cd services/user-service
npm run test:pact:consumer

# Fase 2 — Provider: verifica que el servicio cumple los pacts del consumidor
cd services/user-service
npm run test:pact:verify

cd services/auth-service
npm run test:pact:verify
```

Los pact tests corren con `--runInBand` y timeout de 120 segundos. No requieren infraestructura externa — usan un servidor NestJS de prueba con dependencias mockeadas.

### 6.4 Correr todos los tests en local antes de un PR

```bash
# Desde la raíz — linting
npm run lint

# Por cada servicio modificado
cd services/<nombre-del-servicio>
npm run test:cov
```

---

## 7. Convenciones de código

### Commits

Usa el formato [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<scope>): <descripción en imperativo>

feat(auth): agregar endpoint de revocación de tokens por dispositivo
fix(workflow): corregir condición de race en transición de estado
refactor(common): extraer lógica de CIDR a función utilitaria
test(user-service): agregar casos de borde para roles con permisos vacíos
docs: actualizar CONTRIBUTING con pasos de pact tests
```

Tipos permitidos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`.

### Estilo de código

El proyecto usa ESLint con `@typescript-eslint` y `eslint-plugin-security`. El CI falla con cualquier warning (tolerancia cero):

```bash
# Verificar antes de hacer push
npm run lint
```

Reglas clave:
- Sin `any` implícito — tipado explícito siempre
- Sin `console.log` en código de producción — usar `AppLogger` de `@sgd/common`
- Sin strings literales para topics Kafka — usar `TOPICS` de `@sgd/common`
- Sin comentarios que expliquen qué hace el código — solo comentarios que expliquen por qué

### Tests

- Un archivo `*.spec.ts` por archivo de producción
- Tests de integración en `*.integration.spec.ts` (solo auth-service por ahora)
- Tests de contrato en `*.pact.spec.ts` y `*.provider.spec.ts`
- Usar factory functions para construir objetos de prueba — no repetir `{ id: 'x', ... }` en cada test
- Nunca mockear la base de datos en tests unitarios de servicios que tienen tests de integración

---

## 8. Flujo de ramas y PRs

```
feature/xxx  ──── PR ────►  dev  ──── PR ────►  test  ──── PR ────►  master
                             │                    │                     │
                             ▼                    ▼                     ▼
                        Railway dev         Railway test          Railway prod
```

### Crear una rama

```bash
# Siempre partir desde dev
git checkout dev
git pull origin dev
git checkout -b feature/descripcion-corta
```

Convenciones de nombres:
- `feature/<descripcion>` — nueva funcionalidad
- `fix/<descripcion>` — corrección de bug
- `refactor/<descripcion>` — refactoring sin cambio de comportamiento
- `test/<descripcion>` — solo tests
- `docs/<descripcion>` — solo documentación

### Abrir el PR

1. El PR va **siempre hacia `dev`**, nunca directamente a `test` o `master`
2. El CI debe pasar (`CI OK` check) — sin excepciones
3. Al menos un revisor debe aprobar antes del merge
4. Usa `Squash and merge` para mantener el historial limpio en `dev`

### Promoción a test y prod

- `dev` → `test`: PR manual después de validación en el entorno dev de Railway
- `test` → `master`: PR con aprobación manual requerida (GitHub Environment `production`)

---

## 9. Migraciones de base de datos

Los servicios con PostgreSQL (auth, user, org, workflow, notification) usan TypeORM migrations. Los comandos se ejecutan desde la carpeta del servicio:

```bash
cd services/auth-service  # o cualquier servicio con TypeORM

# Ver el estado actual de las migraciones
npm run migration:show

# Generar una nueva migración a partir de cambios en las entidades
npm run migration:generate -- src/migrations/NombreDescriptivo

# Aplicar migraciones pendientes (en local)
npm run migration:run

# Revertir la última migración aplicada
npm run migration:revert
```

> Los nombres de migración deben ser descriptivos: `AddIndexToDocumentOrgId`, `RenameUserStatusColumn`, no `Migration1234567890`.

En producción, el servidor corre `npm run start:migrate` que aplica las migraciones antes de arrancar. Nunca modifiques una migración ya aplicada en producción — crea una nueva.

---

## 10. Agregar un nuevo servicio

Si el proyecto necesita un nuevo microservicio, sigue estos pasos para que todo el monorepo lo reconozca:

1. **Crear la carpeta** `services/<nombre-del-servicio>/` con el scaffold de NestJS
2. **`package.json`**: nombre `<nombre-del-servicio>`, scripts `test`, `test:cov`, `build`; añadir `@sgd/common: "*"` como dependencia
3. **`jest.config.js`**: copiar de un servicio existente y ajustar `SERVICE_NAME`, `collectCoverageFrom` y `coverageThreshold`
4. **`src/__mocks__/`**: copiar los tres archivos noop de OpenTelemetry de cualquier servicio existente
5. **`.env.example`**: documentar todas las variables requeridas con valores de ejemplo
6. **`Dockerfile`**: copiar de un servicio similar y ajustar el nombre
7. **`railway/ENV_VARIABLES.md`**: agregar la sección del nuevo servicio
8. **`docker-compose.yml`**: agregar el servicio si requiere infra adicional
9. **`railway/api-gateway/kong.yaml`**: agregar las rutas del servicio en Kong
10. **CI** (`ci.yml`): agregar el servicio a los matrices `test-services` y `build-services`
11. **`README.md`**: agregar el servicio a la tabla de servicios y a los ejemplos de variables de entorno

---

## 11. Qué valida el CI

El CI corre en cada push y en cada PR hacia `dev`, `test` y `master`. Todos los jobs deben pasar para que el check `CI OK` se active (requerido por branch protection).

| Job | Qué valida |
|---|---|
| `lint` | ESLint con `eslint-plugin-security` — 0 warnings tolerados |
| `test-services` | Tests unitarios con cobertura ≥ 85% en los 8 servicios (paralelo) |
| `test-integration-auth` | Tests de integración de auth-service contra PostgreSQL + Redis reales |
| `test-contracts` | Contract tests Pact entre auth-service y user-service |
| `test-frontend` | Tests unitarios del repo de frontend |
| `test-e2e` | Tests E2E con Playwright (frontend repo, sin backend real) |
| `build-services` | `tsc` + `docker build` de los 8 servicios (paralelo) |
| `build-api-gateway` | `docker build` del Kong DB-less |
| `security-scan` | TruffleHog — detecta secretos expuestos en el historial de git |

Si un job de la matriz de servicios falla, los demás siguen corriendo (`fail-fast: false`) para que puedas ver todos los problemas de una vez.

---

## 12. Problemas frecuentes

### `Cannot find module '@sgd/common'`
El paquete común no está compilado. Ejecuta:
```bash
npm run build:common
```

### `TS2307: Cannot find module '@sgd/common'` en tests
Verifica que el `moduleNameMapper` del `jest.config.js` apunta a `packages/common/src/index.ts`, no a `dist/`. Si acaba de cambiar algo en `src/`, no necesitas rebuild para tests.

### Jest se queda colgado después de que los tests terminan
Asegúrate de que el `jest.config.js` del servicio tiene `forceExit: true`. Si no lo tiene, agrégalo.

### `EADDRINUSE` al levantar un servicio
Otro proceso está usando el mismo puerto. Cambia `PORT` en el `.env` o detén el proceso que lo ocupa:
```bash
# En Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### Los tests de integración fallan con `ECONNREFUSED`
La infraestructura Docker no está corriendo. Ejecuta `docker compose up -d postgresql redis` y espera unos segundos antes de volver a correr los tests.

### Migración falla con `relation already exists`
La migración ya fue aplicada pero TypeORM no lo registró. Verifica el estado con `npm run migration:show` y, si es necesario, inserta el registro manualmente en la tabla `migrations`.

### `npm ci` falla en Windows con rutas largas
Git tiene un límite de longitud de ruta en Windows. Ejecuta una vez:
```bash
git config --global core.longpaths true
```
