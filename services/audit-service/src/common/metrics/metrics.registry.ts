import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// One registry per process — safe across hot reloads because module-level vars persist.
const registry = new Registry();
collectDefaultMetrics({ register: registry });

let httpRequestDuration: Histogram | undefined;

/**
 * Provide the module-level Prometheus registry for the process.
 *
 * @returns The shared `Registry` instance used to register and collect metrics
 */
export function getRegistry(): Registry {
  return registry;
}

/**
 * Get the module-level Histogram that measures HTTP request durations, creating and registering it on first call.
 *
 * @returns The `http_request_duration_seconds` Histogram that records request duration in seconds with labels `method`, `route`, and `status_code`
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
