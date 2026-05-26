import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// One registry per process — safe across hot reloads because module-level vars persist.
const registry = new Registry();
collectDefaultMetrics({ register: registry });

let httpRequestDuration: Histogram | undefined;

/**
 * Get the module-level Prometheus `Registry` used by the process.
 *
 * @returns The shared `Registry` instance used to register metrics
 */
export function getRegistry(): Registry {
  return registry;
}

/**
 * Returns the process-shared Histogram used to measure HTTP request durations.
 *
 * The histogram is initialized on first use and is configured with `method`, `route`, and `status_code` labels and second-based buckets for request durations.
 *
 * @returns The shared `Histogram` instance for HTTP request duration in seconds.
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
