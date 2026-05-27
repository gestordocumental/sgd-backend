jest.mock('@sentry/node', () => ({
  init: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import './instrument';

describe('instrument', () => {
  it('initializes Sentry safely when no DSN is configured', () => {
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: process.env.SENTRY_DSN,
        enabled: !!process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: 0.1,
      }),
    );
  });
});
