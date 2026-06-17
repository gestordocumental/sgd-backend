import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL       = __ENV.BASE_URL        || 'https://api-dev.railway.app';
const ADMIN_EMAIL    = __ENV.ADMIN_EMAIL     || 'admin@sgd.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD  || 'Admin1234!';
// 30 usuarios: cada VU usa 3 del pool (creator, approver, finalUser rotando)
const N_USERS        = parseInt(__ENV.N_USERS || '30', 10);
const TEST_PASSWORD  = 'K6#LoadTest!A';

const errorRate      = new Rate('error_rate');
const createDuration = new Trend('workflow_create_duration', true);

export const options = {
  setupTimeout:    '15m',
  teardownTimeout: '10m',
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: 10  },
        { duration: '2m', target: 25  },
        { duration: '2m', target: 50  },
        { duration: '3m', target: 100 },
        { duration: '2m', target: 100 }, // sustain al pico
        { duration: '2m', target: 0   }, // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration:       ['p(95)<3000'], // escrituras son más lentas que lecturas
    error_rate:              ['rate<0.05'],
    workflow_create_duration: ['p(95)<3000'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
export function setup() {
  const adminToken = adminLogin();

  // ── Obtener org ──────────────────────────────────────────────────────────
  const orgsRes = http.get(`${BASE_URL}/api/v1/org?page=1&limit=1`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
  });
  let orgId = __ENV.ORG_ID || null;
  if (!orgId) {
    try {
      const orgsBody = JSON.parse(orgsRes.body);
      const orgs     = orgsBody.data ?? orgsBody;
      if (Array.isArray(orgs) && orgs.length > 0) orgId = orgs[0].id;
    } catch (_) {}
  }
  if (!orgId) {
    throw new Error('[setup] No se encontró ninguna organización. Pasa -e ORG_ID=<uuid> o crea una org primero.');
  }
  console.log(`[setup] Usando orgId: ${orgId}`);

  // ── Switch-company del admin para acceder a recursos con companyId ────────
  const switchAdminRes = http.post(
    `${BASE_URL}/api/v1/auth/switch-company`,
    JSON.stringify({ companyId: orgId }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` } },
  );
  let adminCompanyToken;
  try { adminCompanyToken = JSON.parse(switchAdminRes.body).accessToken; } catch (_) {}
  if (!adminCompanyToken) {
    throw new Error(`[setup] switch-company del admin falló: ${switchAdminRes.status} ${switchAdminRes.body}`);
  }

  // ── Obtener tipologías activas de la org ──────────────────────────────────
  const typologiesRes = http.get(
    `${BASE_URL}/api/v1/documents/${orgId}/typologies?page=1&limit=20`,
    { headers: { Authorization: `Bearer ${adminCompanyToken}`, 'Content-Type': 'application/json' } },
  );

  let typologyIds = [];
  try {
    const parsed = JSON.parse(typologiesRes.body);
    const list   = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    typologyIds  = list.map((t) => t.id).filter(Boolean);
  } catch (_) {}

  if (typologyIds.length === 0) {
    throw new Error(
      `[setup] No se encontraron tipologías activas para orgId=${orgId}. ` +
      'Crea al menos una tipología en document-service antes de correr este test.',
    );
  }
  console.log(`[setup] ${typologyIds.length} tipología(s) disponibles: ${typologyIds.slice(0, 3).join(', ')}...`);

  // ── Crear / restaurar usuarios de prueba ──────────────────────────────────
  const users        = [];
  const cleanupUsers = [];

  for (let i = 0; i < N_USERS; i++) {
    const email = `k6wf${String(i).padStart(3, '0')}@sgd.local`;

    const createRes = http.post(
      `${BASE_URL}/api/v1/users`,
      JSON.stringify({ email, orgId }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` } },
    );

    let userId;
    let isRestored = false;

    if (createRes.status === 201) {
      try { userId = JSON.parse(createRes.body).id; } catch (_) {}
      if (!userId) {
        console.warn(`[setup] Respuesta inesperada al crear ${email}: ${createRes.body}`);
        continue;
      }
    } else if (createRes.status === 409) {
      let parsedBody;
      try { parsedBody = JSON.parse(createRes.body); } catch (_) {}
      userId = parsedBody?.userId;
      if (!userId) {
        console.warn(`[setup] 409 sin userId para ${email}: ${createRes.body}`);
        continue;
      }
      const restoreRes = http.post(
        `${BASE_URL}/api/v1/users/${userId}/restore`,
        null,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` } },
      );
      if (restoreRes.status !== 200 && restoreRes.status !== 201) {
        console.warn(`[setup] No se pudo restaurar ${email}: ${restoreRes.status} ${restoreRes.body}`);
        continue;
      }
      isRestored = true;
      console.log(`[setup] Usuario restaurado: ${email}`);
    } else {
      console.warn(`[setup] No se pudo crear ${email}: ${createRes.status} ${createRes.body}`);
      continue;
    }

    cleanupUsers.push({ userId, email });

    sleep(isRestored ? 2 : 4);

    const provisionRes = http.post(
      `${BASE_URL}/api/v1/users/${userId}/provision`,
      JSON.stringify({ password: TEST_PASSWORD }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` } },
    );
    if (provisionRes.status !== 200 && provisionRes.status !== 201) {
      console.warn(`[setup] No se pudo provisionar ${email}: ${provisionRes.status} ${provisionRes.body}`);
      continue;
    }

    sleep(2);

    // Login con reintentos ante throttle
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
      console.warn(`[setup] Login falló definitivamente para ${email}: ${loginRes?.status}`);
      continue;
    }

    let globalToken;
    try { globalToken = JSON.parse(loginRes.body).accessToken; } catch (_) {}
    if (!globalToken) {
      console.warn(`[setup] No se obtuvo accessToken para ${email}: ${loginRes.body}`);
      continue;
    }

    // switch-company → token con companyId (necesario para crear workflows)
    const switchRes = http.post(
      `${BASE_URL}/api/v1/auth/switch-company`,
      JSON.stringify({ companyId: orgId }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${globalToken}` } },
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
    sleep(0.3);
  }

  if (users.length < 3) {
    throw new Error(
      `[setup] Se necesitan al menos 3 usuarios de prueba para rotar roles ` +
      `(creator, approver, finalUser). Solo se crearon ${users.length}.`,
    );
  }

  console.log(`[setup] ${users.length} usuarios de prueba listos.`);
  return { users, cleanupUsers, orgId, typologyIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT — flujo de cada VU
// ─────────────────────────────────────────────────────────────────────────────
export default function (data) {
  const n = data.users.length;

  // Cada VU toma 3 usuarios distintos rotando por el pool:
  //   creator   = el que autentica y crea el workflow
  //   approver  = referenciado como aprobador (paso 1)
  //   finalUser = referenciado como usuario final del workflow
  const idx       = (__VU - 1) % n;
  const creator   = data.users[idx];
  const approver  = data.users[(idx + 1) % n];
  const finalUser = data.users[(idx + 2) % n];

  // Rotar tipologías entre iteraciones para distribuir carga en document-service
  const typologyId = data.typologyIds[__ITER % data.typologyIds.length];

  createWorkflow(creator.token, approver.userId, finalUser.userId, typologyId);

  // Think time mayor que en lecturas — cada creación dispara escrituras + Kafka
  sleep(Math.random() * 2 + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN — elimina usuarios de prueba
// ─────────────────────────────────────────────────────────────────────────────
export function teardown(data) {
  const adminToken = adminLogin();

  const toDelete = data.cleanupUsers ?? data.users;
  let deleted = 0;
  for (const { userId, email } of toDelete) {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = http.del(
        `${BASE_URL}/api/v1/users/${userId}`,
        null,
        { headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' } },
      );
      if (res.status === 200 || res.status === 204) { deleted++; break; }
      if (res.status === 429) {
        console.log(`[teardown] Rate limit al borrar ${email} (intento ${attempt}/3). Esperando 65s...`);
        sleep(65);
        continue;
      }
      console.warn(`[teardown] No se pudo borrar ${email}: ${res.status}`);
      break;
    }
    sleep(0.2);
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
      try { token = JSON.parse(res.body).accessToken; } catch (_) {}
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

function logError(endpoint, status) {
  const category = status === 401 ? 'EXPIRED_TOKEN' : status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`;
  console.warn(`[ERROR] ${endpoint} → ${status} (${category}) VU=${__VU} iter=${__ITER}`);
}

function createWorkflow(token, approverId, finalUserId, typologyId) {
  const title = `K6 WF VU${__VU} iter${__ITER} ${Date.now()}`;

  const payload = JSON.stringify({
    title,
    typologyId,
    approvers:    [{ userId: approverId, stepOrder: 1 }],
    finalUserIds: [finalUserId],
  });

  const start = Date.now();
  const res   = http.post(
    `${BASE_URL}/api/v1/workflows`,
    payload,
    { ...authHeaders(token), tags: { type: 'create_workflow' } },
  );
  createDuration.add(Date.now() - start);

  const ok = check(res, { 'create workflow 201': (r) => r.status === 201 });
  if (!ok) logError('create_workflow', res.status);
  errorRate.add(!ok);
}
