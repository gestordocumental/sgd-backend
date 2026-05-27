import { AppLogger } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('logger-correlation-id'),
}));

// Winston is a real dependency — we spy on its internal methods rather than
// mocking the whole module, keeping the test isolated from implementation details.

describe('AppLogger', () => {
  let logger: AppLogger;
  let winstonSpy: {
    info:  jest.SpyInstance;
    error: jest.SpyInstance;
    warn:  jest.SpyInstance;
    debug: jest.SpyInstance;
  };

  beforeEach(() => {
    logger = new AppLogger();
    // Access the private winston instance via type cast
    const winston = (logger as any).winston;
    winstonSpy = {
      info:  jest.spyOn(winston, 'info').mockImplementation(() => logger),
      error: jest.spyOn(winston, 'error').mockImplementation(() => logger),
      warn:  jest.spyOn(winston, 'warn').mockImplementation(() => logger),
      debug: jest.spyOn(winston, 'debug').mockImplementation(() => logger),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  // ── log() ─────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('delegates to winston.info with correct shape', () => {
      logger.log('Hello world', 'TestCtx');

      expect(winstonSpy.info).toHaveBeenCalledWith(
        expect.objectContaining({
          level:         'info',
          message:       'Hello world',
          context:       'TestCtx',
          correlationId: 'logger-correlation-id',
          service:       'document-service',
        }),
      );
    });

    it('defaults context to "App" when not provided', () => {
      logger.log('No context');

      expect(winstonSpy.info).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  // ── error() ───────────────────────────────────────────────────────────────

  describe('error()', () => {
    it('delegates to winston.error with trace', () => {
      logger.error('Something broke', 'stack trace here', 'ErrorCtx');

      expect(winstonSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          level:   'error',
          message: 'Something broke',
          context: 'ErrorCtx',
          trace:   'stack trace here',
        }),
      );
    });

    it('works without trace or context', () => {
      logger.error('Bare error');

      expect(winstonSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Bare error', context: 'App' }),
      );
    });
  });

  // ── warn() ────────────────────────────────────────────────────────────────

  describe('warn()', () => {
    it('delegates to winston.warn', () => {
      logger.warn('Watch out', 'WarnCtx');

      expect(winstonSpy.warn).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn', message: 'Watch out', context: 'WarnCtx' }),
      );
    });
  });

  // ── debug() ───────────────────────────────────────────────────────────────

  describe('debug()', () => {
    it('delegates to winston.debug', () => {
      logger.debug('Debug message', 'DebugCtx');

      expect(winstonSpy.debug).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'debug', message: 'Debug message' }),
      );
    });
  });

  // ── http() ────────────────────────────────────────────────────────────────

  describe('http()', () => {
    it('delegates to winston.info with merged data and service name', () => {
      logger.http({ type: 'request', method: 'GET', path: '/health' });

      expect(winstonSpy.info).toHaveBeenCalledWith(
        expect.objectContaining({
          type:          'request',
          method:        'GET',
          path:          '/health',
          correlationId: 'logger-correlation-id',
          service:       'document-service',
        }),
      );
    });
  });

  // ── NODE_ENV development ──────────────────────────────────────────────────

  describe('in development mode', () => {
    it('creates logger without throwing', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      expect(() => new AppLogger()).not.toThrow();
      process.env.NODE_ENV = originalEnv;
    });
  });
});
