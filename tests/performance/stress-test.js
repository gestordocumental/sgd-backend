import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL      = __ENV.BASE_URL       || 'https://api-dev.railway.app';
const ADMIN_EMAIL   = __ENV.ADMIN_EMAIL    || 'admin@sgd.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin1234!';
// 50 usuarios: ~8 VUs por token en la carga pico (400 VUs).
const N_USERS = parseInt(__ENV.N_USERS || '50', 10);
const TEST_PASSWORD = 'K6#LoadTest!A';

const errorRate   = new Rate('error_rate');
const listDuration = new Trend('list_resources_duration', true);

export const options = {
  setupTimeout: '15m',    // 50 usuarios × ~7s c/u ≈ 6min; margen extra para throttle
  teardownTimeout: '10m', // 50 deletes × retry con backoff — el default de 60s es insuficiente
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m',  target: 50 },
        { duration: '2m',  target: 100 },
        { duration: '2m',  target: 200 },
        { duration: '3m',  target: 300 },
        { duration: '3m',  target: 400 },
        { duration: '3m',  target: 400 }, // sustain al pico
        { duration: '2m',  target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    error_rate:        ['rate<0.05'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — corre una sola vez antes del test
// ─────────────────────────────────────────────────────────────────────────────
export function setup() {
  const adminToken = adminLogin();

  // Obtener el primer org disponible para asignar los usuarios de prueba
  const orgsRes = http.get(`${BASE_URL}/api/v1/org?page=1&limit=1`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
  });
  let orgId = __ENV.ORG_ID || null;
  if (!orgId) {
    try {
      const orgsBody = JSON.parse(orgsRes.body);
      const orgs = orgsBody.data ?? orgsBody;
      if (Array.isArray(orgs) && orgs.length > 0) orgId = orgs[0].id;
    } catch (_) {}
  }
  if (!orgId) {
    throw new Error('[setup] No se encontró ninguna organización. Pasa -e ORG_ID=<uuid> o crea una org primero.');
  }
  console.log(`[setup] Usando orgId: ${orgId}`);

  const users = [];
  const cleanupUsers = [];

  for (let i = 0; i < N_USERS; i++) {
    const email = `k6test${String(i).padStart(3, '0')}@sgd.local`;

    // 1. Crear usuario asignado al org
    const createRes = http.post(
      `${BASE_URL}/api/v1/users`,
      JSON.stringify({ email, orgId }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );

    if (createRes.status !== 201) {
      console.warn(`[setup] No se pudo crear ${email}: ${createRes.status} ${createRes.body}`);
      continue;
    }

    let userId;
    try {
      userId = JSON.parse(createRes.body).id;
    } catch (_) {}
    if (!userId) {
      console.warn(`[setup] Respuesta inesperada al crear ${email}: ${createRes.body}`);
      continue;
    }
    // Registrar para cleanup inmediatamente — los continues posteriores no deben dejar al usuario sin borrar
    cleanupUsers.push({ userId, email });

    // 2. Espera a que Kafka procese la creación de credenciales en auth-service
    sleep(4);

    // 3. Asignar contraseña via provision
    const provisionRes = http.post(
      `${BASE_URL}/api/v1/users/${userId}/provision`,
      JSON.stringify({ password: TEST_PASSWORD }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );

    if (provisionRes.status !== 200 && provisionRes.status !== 201) {
      console.warn(`[setup] No se pudo provisionar ${email}: ${provisionRes.status} ${provisionRes.body}`);
      continue;
    }

    // 4. Espera adicional para que auth-service procese la provision
    sleep(2);

    // 5. Login con reintentos
    let loginRes;
    for (let attempt = 1; attempt <= 3; attempt++) {
      loginRes = http.post(
        `${BASE_URL}/api/v1/auth/login`,
        JSON.stringify({ email, password: TEST_PASSWORD }),
        { headers: { 'Content-Type': 'application/json' } },
      );
      if (loginRes.status === 200 || loginRes.status === 201) break;
      if (loginRes.status === 429) {
        console.log(`[setup] Throttle en login de ${email} (intento ${attempt}/3). Esperando 65s...`);
        sleep(65);
      } else {
        console.warn(`[setup] Login ${email} intento ${attempt}/3: ${loginRes.status}`);
        sleep(3);
      }
    }

    if (!loginRes || (loginRes.status !== 200 && loginRes.status !== 201)) {
      console.warn(`[setup] Login falló definitivamente para ${email}: ${loginRes?.status} ${loginRes?.body}`);
      continue;
    }

    let globalToken;
    try {
      globalToken = JSON.parse(loginRes.body).accessToken;
    } catch (_) {}
    if (!globalToken) {
      console.warn(`[setup] No se obtuvo accessToken para ${email}: ${loginRes.body}`);
      continue;
    }

    // 6. switch-company → token con companyId + permisos embebidos
    const switchRes = http.post(
      `${BASE_URL}/api/v1/auth/switch-company`,
      JSON.stringify({ companyId: orgId }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${globalToken}`,
        },
      },
    );

    let token;
    if (switchRes.status === 200 || switchRes.status === 201) {
      try { token = JSON.parse(switchRes.body).accessToken; } catch (_) {}
    }
    if (!token) {
      console.warn(`[setup] switch-company falló para ${email}: ${switchRes.status} — usando token global`);
      token = globalToken;
    }

    users.push({ userId, email, token });

    // Pausa pequeña para no activar el rate limiter durante el setup
    sleep(0.3);
  }

  if (users.length === 0) {
    throw new Error('[setup] No se creó ningún usuario de prueba. Abortando.');
  }

  console.log(`[setup] ${users.length} usuarios de prueba autenticados (${cleanupUsers.length} creados en total).`);
  // orgId se propaga al default() para que listOrgs use el endpoint correcto
  return { users, cleanupUsers, orgId };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT — flujo que ejecuta cada VU en cada iteración
// ─────────────────────────────────────────────────────────────────────────────
export default function (data) {
  // Cada VU usa su propio token del pool — distribuye carga uniformemente
  const { token } = data.users[__VU % data.users.length];

  listUsers(token);
  sleep(0.3);

  // FIX: GET /api/v1/org requiere isSuperAdmin — los usuarios de prueba son usuarios
  // normales. El endpoint correcto para leer la org del usuario es GET /org/mine.
  listMyOrg(token, data.orgId);
  sleep(0.3);

  listWorkflows(token);
  sleep(0.3);

  getMe(token);

  sleep(Math.random() * 1 + 0.5); // think time: 0.5-1.5s
}

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN — limpia usuarios de prueba con retry ante 429
// ─────────────────────────────────────────────────────────────────────────────
export function teardown(data) {
  const adminToken = adminLogin();

  const toDelete = data.cleanupUsers ?? data.users;
  let deleted = 0;
  for (const { userId, email } of toDelete) {
    let res;
    // Hasta 3 intentos con backoff de 65s si el rate limiter sigue activo
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = http.del(
        `${BASE_URL}/api/v1/users/${userId}`,
        null,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (res.status === 200 || res.status === 204) {
        deleted++;
        break;
      }

      if (res.status === 429) {
        console.log(`[teardown] Rate limit al borrar ${email} (intento ${attempt}/3). Esperando 65s...`);
        sleep(65);
        continue;
      }

      console.warn(`[teardown] No se pudo borrar ${email}: ${res.status}`);
      break;
    }

    sleep(0.2); // pausa entre deletes para no acumular rate limit
  }

  console.log(`[teardown] ${deleted}/${toDelete.length} usuarios de prueba eliminados.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function adminLogin() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    if (res.status === 200 || res.status === 201) {
      let token;
      try {
        token = JSON.parse(res.body).accessToken;
      } catch (_) {}
      if (!token) throw new Error(`[adminLogin] Body inesperado: ${res.body}`);
      return token;
    }

    if (res.status === 429) {
      console.log(`[adminLogin] Throttle activo (intento ${attempt}/5). Esperando 65s...`);
      sleep(65);
      continue;
    }

    throw new Error(`[adminLogin] Falló con status ${res.status}: ${res.body}`);
  }

  throw new Error('[adminLogin] Se agotaron los reintentos por throttle.');
}

function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

function listUsers(token) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/users?page=1&limit=10`,
    { ...authHeaders(token), tags: { type: 'list_users' } },
  );
  listDuration.add(Date.now() - start);
  errorRate.add(!check(res, { 'list users 200': (r) => r.status === 200 }));
}

// FIX: usa GET /org/mine?ids=orgId (AuthOnly) en vez de GET /org (SuperAdminOnly).
// GET /org lista todas las orgs del sistema — solo accesible por super admins.
// GET /org/mine resuelve los detalles de la org del usuario autenticado.
function listMyOrg(token, orgId) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/org/mine?ids=${orgId}`,
    { ...authHeaders(token), tags: { type: 'list_orgs' } },
  );
  listDuration.add(Date.now() - start);
  errorRate.add(!check(res, { 'list orgs 200': (r) => r.status === 200 }));
}

function listWorkflows(token) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/workflows?page=1&limit=10`,
    { ...authHeaders(token), tags: { type: 'list_workflows' } },
  );
  listDuration.add(Date.now() - start);
  errorRate.add(!check(res, { 'list workflows 200': (r) => r.status === 200 }));
}

function getMe(token) {
  const res = http.get(
    `${BASE_URL}/api/v1/auth/me`,
    { ...authHeaders(token), tags: { type: 'get_me' } },
  );
  errorRate.add(!check(res, { 'get me 200': (r) => r.status === 200 }));
}
