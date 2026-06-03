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

| Script | Descripción |
|---|---|
| `stress-test.js` | Ramp-up gradual 1→150 VUs — encuentra el límite de usuarios concurrentes |
| `spike-test.js` | Spike repentino a 200 VUs — mide la resiliencia ante picos |

## Cómo correr

### Stress test (ramp-up gradual)
```bash
k6 run \
  -e BASE_URL=https://api-dev.railway.app \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/stress-test.js
```

### Spike test
```bash
k6 run \
  -e BASE_URL=https://api-dev.railway.app \
  -e ADMIN_EMAIL=admin@sgd.local \
  -e ADMIN_PASSWORD=Admin1234! \
  tests/performance/spike-test.js
```

### Con reporte HTML (requiere k6-reporter)
```bash
k6 run --out json=results.json tests/performance/stress-test.js
```

## Interpretar resultados

### Métricas clave

- **`http_req_duration`** — tiempo de respuesta. Busca `p(95)` y `p(99)`.
- **`error_rate`** — porcentaje de requests fallidas. Debe estar bajo 5%.
- **`login_duration`** — tiempo de login específicamente.
- **`http_req_failed`** — total de requests con error HTTP.
- **`vus`** — usuarios virtuales activos en cada momento.

### Thresholds configurados

| Threshold | Límite | Significado |
|---|---|---|
| `http_req_duration p(95)` | < 2000ms | 95% de requests responden en < 2s |
| `error_rate` | < 5% | Menos del 5% de requests fallidas |

> El login ocurre solo en `setup()` (una vez, fuera del loop de carga), por lo que no existe threshold de `login_duration` en el test principal.

### Señales de que encontraste el límite

- `error_rate` sube por encima del 5%
- `p(95)` supera los 2000ms
- Los checks de status 200 empiezan a fallar
- El número de VUs donde esto ocurre es tu límite de usuarios concurrentes

## Flujo que simula stress-test.js

Cada usuario virtual hace:
1. `POST /api/v1/auth/login` — obtiene token
2. `GET /api/v1/users?page=1&limit=10`
3. `GET /api/v1/org?page=1&limit=10`
4. `GET /api/v1/workflows?page=1&limit=10`
5. `GET /api/v1/auth/me`
6. Espera 1-3 segundos (think time) y repite
