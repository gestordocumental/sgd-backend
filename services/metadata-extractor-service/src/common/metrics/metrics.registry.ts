import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// One registry per process — safe across hot reloads because module-level vars persist.
const registry = new Registry();
collectDefaultMetrics({ register: registry });

let httpRequestDuration: Histogram | undefined;

/**
 * Provide the module-level Prometheus metrics Registry used by this process.
 *
 * @returns The module-level Prometheus Registry instance
 */
export function getRegistry(): Registry {
  return registry;
}

/**
 * Get the process-wide Histogram used to observe HTTP request durations, creating and registering it if missing.
 *
 * @returns The `Histogram` named `http_request_duration_seconds` configured with labels `method`, `route`, `status_code` and buckets [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
 */
export function getHttpRequestDurationHistogram(): Histogram {
  if (!httpRequestDuration) {
    httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    });
  }
  return httpRequestDuration;
}
