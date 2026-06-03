import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL      = __ENV.BASE_URL       || 'https://api-dev.railway.app';
const ADMIN_EMAIL   = __ENV.ADMIN_EMAIL    || 'admin@sgd.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin1234!';
// Cuántos usuarios de prueba crear — 1 token cada 10 VUs es suficiente
const N_USERS = parseInt(__ENV.N_USERS || '100', 10);
const TEST_PASSWORD = 'K6#LoadTest!A';

const errorRate   = new Rate('error_rate');
const listDuration = new Trend('list_resources_duration', true);

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m',  target: 50 },
        { duration: '2m',  target: 100 },
        { duration: '2m',  target: 250 },
        { duration: '3m',  target: 500 },
        { duration: '3m',  target: 750 },
        { duration: '3m',  target: 1000 },
        { duration: '2m',  target: 1000 },
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
// Crea N usuarios de prueba y devuelve sus tokens + IDs para el teardown
// ─────────────────────────────────────────────────────────────────────────────
export function setup() {
  const adminToken = adminLogin();

  const users = [];

  for (let i = 0; i < N_USERS; i++) {
    const email = `k6test${String(i).padStart(3, '0')}@sgd.local`;

    // 1. Crear usuario
    const createRes = http.post(
      `${BASE_URL}/api/v1/users`,
      JSON.stringify({ email }),
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

    // 2. Espera a que Kafka procese la creación de credenciales en auth-service
    sleep(2);

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

    // 4. Login como el nuevo usuario para obtener su token
    const loginRes = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ email, password: TEST_PASSWORD }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    if (loginRes.status !== 200 && loginRes.status !== 201) {
      console.warn(`[setup] Login falló para ${email}: ${loginRes.status} ${loginRes.body}`);
      continue;
    }

    let token;
    try {
      token = JSON.parse(loginRes.body).accessToken;
    } catch (_) {}
    if (!token) {
      console.warn(`[setup] No se obtuvo accessToken para ${email}: ${loginRes.body}`);
      continue;
    }
    users.push({ userId, email, token });

    // Pausa pequeña para no activar el rate limiter durante el setup
    sleep(0.3);
  }

  if (users.length === 0) {
    throw new Error('[setup] No se creó ningún usuario de prueba. Abortando.');
  }

  console.log(`[setup] ${users.length} usuarios de prueba creados y autenticados.`);
  return { users };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT — flujo que ejecuta cada VU en cada iteración
// ─────────────────────────────────────────────────────────────────────────────
export default function (data) {
  // Cada VU usa su propio token del pool — distribuye carga uniformemente
  const { token } = data.users[__VU % data.users.length];

  listUsers(token);
  sleep(0.3);

  listOrgs(token);
  sleep(0.3);

  listWorkflows(token);
  sleep(0.3);

  getMe(token);

  sleep(Math.random() * 1 + 0.5); // think time: 0.5-1.5s
}

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN — corre una sola vez al final, limpia los usuarios de prueba
// ─────────────────────────────────────────────────────────────────────────────
export function teardown(data) {
  const adminToken = adminLogin();

  let deleted = 0;
  for (const { userId, email } of data.users) {
    const res = http.del(
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
    } else {
      console.warn(`[teardown] No se pudo borrar ${email}: ${res.status}`);
    }
    sleep(0.1);
  }

  console.log(`[teardown] ${deleted}/${data.users.length} usuarios de prueba eliminados.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function adminLogin() {
  // Reintenta hasta 5 veces con backoff de 65s si hay throttle activo
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

function listOrgs(token) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/org?page=1&limit=10`,
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
