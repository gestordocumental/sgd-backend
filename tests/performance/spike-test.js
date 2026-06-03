import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Prueba de pico: simula un spike repentino de usuarios
const BASE_URL = __ENV.BASE_URL || 'https://api-dev.railway.app';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@sgd.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin1234!';

const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },    // baseline
        { duration: '10s', target: 200 },  // spike repentino
        { duration: '1m', target: 200 },   // mantiene el pico
        { duration: '10s', target: 5 },    // baja rápido
        { duration: '30s', target: 0 },    // enfriamiento
      ],
    },
  },
  thresholds: {
    error_rate: ['rate<0.10'],             // máx 10% errores en spike
    http_req_duration: ['p(95)<5000'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const ok = check(res, {
    'login ok': (r) => r.status === 200 || r.status === 201,
  });
  errorRate.add(!ok);

  if (!ok) return;

  const token = JSON.parse(res.body).accessToken;

  http.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  sleep(1);
}
