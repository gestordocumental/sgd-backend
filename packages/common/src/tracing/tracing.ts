import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let _sdk: NodeSDK | undefined;

/**
 * Initializes the OpenTelemetry NodeSDK with auto-instrumentation for HTTP, Express,
 * PostgreSQL, Redis, and KafkaJS. Spans are exported via OTLP HTTP to the endpoint
 * configured in OTEL_EXPORTER_OTLP_ENDPOINT.
 *
 * Must be called BEFORE any other import in instrument.ts so the auto-patching hooks
 * are registered before NestJS, TypeORM, ioredis, or kafkajs modules are loaded.
 *
 * No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset (e.g. unit-test environments).
 */
export function initTracing(serviceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  _sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs, dns and net produce thousands of low-signal spans — disable them.
        '@opentelemetry/instrumentation-fs':  { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  _sdk.start();

  const shutdown = (): void => { void _sdk?.shutdown(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT',  shutdown);
}
