import * as Sentry from '@sentry/node';

// Initialized once at process start — Sentry is a no-op when SENTRY_DSN is not set.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
