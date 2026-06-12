import { initTracing } from '@sgd/common';
import * as Sentry from '@sentry/node';

// OTEL must be initialized first so auto-patching hooks are registered before
// NestJS, Express, TypeORM, Redis, and KafkaJS modules are loaded.
initTracing('auth-service');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
