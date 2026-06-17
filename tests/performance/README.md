# Pruebas de Rendimiento — SGD Helisa

## Instalación de k6

```bash
# Windows (winget)
winget install k6 --source winget

# macOS
brew install k6

# Linux
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Scripts disponibles

| Script | Tipo | VUs máx | Duración | Descripción |
|---|---|---|---|---|
| `stress-test.js` | Lectura | 400 | ~16 min | Ramp-up gradual — mide límite de usuarios leyendo datos |
| `workflow-creation-stress-test.js` | Escritura | 250 | ~12 min | Ramp-up gradual — mide límite de usuarios creando workflows |
| `spike-test.js` | Spike | 200 | ~2.5 min | Spike repentino — mide resiliencia de login ante picos |

## Cómo correr

### Stress test — lectura (ramp-up gradual)

Crea 50 usuarios de prueba (`k6test000–049`), los autentica en `setup()` y luego cada VU repite el ciclo de lectura.

```bash
k6 run \
  -e BASE_URL=https://api-dev.railway.app \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/stress-test.js
```

### Workflow creation stress test — escritura (ramp-up gradual)

Crea 30 usuarios de prueba (`k6wf000–029`), hace switch-company y pre-carga tipologías en `setup()`. Cada VU crea un workflow real en cada iteración.

```bash
k6 run \
  -e BASE_URL=https://api-dev.railway.app \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/workflow-creation-stress-test.js
```

Opcionalmente, fijar la org con `-e ORG_ID=<uuid>` para saltar la búsqueda automática.

### Spike test

Dispara 200 VUs en 10 segundos. Cada VU hace login con las credenciales de admin en cada iteración — mide el endpoint de autenticación bajo carga repentina.

```bash
k6 run \
  -e BASE_URL=https://api-dev.railway.app \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/spike-test.js
```

## Flujos simulados

### stress-test.js

`setup()` crea y autentica 50 usuarios de prueba (una sola vez). Cada VU en `default()` ejecuta este ciclo con su propio token pre-cargado:

1. `GET /api/v1/users?page=1&limit=10`
2. `GET /api/v1/org/mine?ids=<orgId>`
3. `GET /api/v1/workflows?page=1&limit=10`
4. `GET /api/v1/auth/me`
5. Think time 0.5–1.5 s y repite

### workflow-creation-stress-test.js

`setup()` crea 30 usuarios de prueba, hace switch-company por cada uno y obtiene los IDs de tipologías disponibles. Cada VU en `default()`:

1. Selecciona 3 usuarios del pool rotando: creator, approver, finalUser
2. `POST /api/v1/workflows` — crea un workflow con título único `K6 WF VU{n} iter{n} {timestamp}`
3. Think time 1–3 s y repite

### spike-test.js

Sin `setup()` — cada VU en `default()` hace login fresco en cada iteración:

1. `POST /api/v1/auth/login` — obtiene token
2. `GET /api/v1/auth/me`
3. Sleep 1 s y repite

## Thresholds configurados

| Script | Métrica | Límite |
|---|---|---|
| `stress-test.js` | `http_req_duration p(95)` | < 2 000 ms |
| `stress-test.js` | `error_rate` | < 5 % |
| `workflow-creation-stress-test.js` | `http_req_duration p(95)` | < 3 000 ms |
| `workflow-creation-stress-test.js` | `workflow_create_duration p(95)` | < 3 000 ms |
| `workflow-creation-stress-test.js` | `error_rate` | < 5 % |
| `spike-test.js` | `http_req_duration p(95)` | < 5 000 ms |
| `spike-test.js` | `error_rate` | < 10 % |

## Métricas clave

| Métrica | Script | Descripción |
|---|---|---|
| `http_req_duration` | todos | Latencia total de cada request. Revisar `p(95)` y `p(99)` |
| `error_rate` | todos | Porcentaje de requests fallidas. Debe mantenerse bajo el threshold |
| `list_resources_duration` | stress-test | Latencia de los 4 endpoints de lectura |
| `workflow_create_duration` | workflow-creation | Latencia exclusiva del `POST /api/v1/workflows` |
| `vus` | todos | Usuarios virtuales activos en cada momento |

## Señales de que encontraste el límite

- `error_rate` supera el threshold configurado
- `p(95)` de `http_req_duration` supera el límite
- Los checks de status 200/201 empiezan a fallar masivamente
- El VU count donde esto ocurre es el límite de concurrencia del sistema

## Resultados de referencia

| Test | Entorno | VUs pico | p95 | Error rate | Notas |
|---|---|---|---|---|---|
| `workflow-creation-stress-test.js` | Railway dev | 100 | 1 630 ms | 0 % | 15 751 workflows creados en ~12 min |
| `stress-test.js` | Railway dev | 400 | — | ~50 % | Tokens JWT expiraron a mitad del test (setup ~7 min + test 16 min > TTL 15 min) |

> El 50 % de error en `stress-test.js` a 400 VUs se debe a expiración de JWT, no a saturación del servidor. Los tokens se minan en `setup()` y expiran antes de que termine el test. Para ejecutarlo sin errores por expiración, reducir el número de stages o aumentar `JWT_EXPIRATION` en auth-service durante la prueba.
