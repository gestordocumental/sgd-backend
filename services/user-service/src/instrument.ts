import { initTracing } from '@sgd/common';
import * as Sentry from '@sentry/node';

initTracing('user-service');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
