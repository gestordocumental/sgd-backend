import { AppLogger } from '@sgd/common';

// ─── Mock winston so we never open real Console transports ───────────────────

const mockWinstonLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

jest.mock('winston', () => {
  const actualFormat = {
    combine: jest.fn((...args: unknown[]) => args),
    colorize: jest.fn(),
    timestamp: jest.fn(),
    printf: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
  };
  return {
    createLogger: jest.fn(() => mockWinstonLogger),
    format: actualFormat,
    transports: {
      Console: jest.fn(),
    },
  };
});

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('logger-correlation-id'),
}));

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new AppLogger();
  });

  // ─── log ──────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('calls winston.info with the correct structured payload', () => {
      logger.log('test message', 'TestContext');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'test message',
          context: 'TestContext',
          correlationId: 'logger-correlation-id',
          service: 'user-service',
        }),
      );
    });

    it('defaults context to "App" when no context is provided', () => {
      logger.log('no context message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  // ─── error ────────────────────────────────────────────────────────────────

  describe('error()', () => {
    it('calls winston.error with message, trace, and context', () => {
      logger.error('error message', 'Error: stack trace here', 'ErrorContext');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'error message',
          context: 'ErrorContext',
          trace: 'Error: stack trace here',
          correlationId: 'logger-correlation-id',
        }),
      );
    });

    it('allows trace to be undefined', () => {
      logger.error('error only');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'error only',
          trace: undefined,
        }),
      );
    });
  });

  // ─── warn ─────────────────────────────────────────────────────────────────

  describe('warn()', () => {
    it('calls winston.warn with the correct payload', () => {
      logger.warn('warning message', 'WarnContext');

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'warning message',
          context: 'WarnContext',
        }),
      );
    });
  });

  // ─── debug ────────────────────────────────────────────────────────────────

  describe('debug()', () => {
    it('calls winston.debug with the correct payload', () => {
      logger.debug('debug message', 'DebugContext');

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          message: 'debug message',
          context: 'DebugContext',
        }),
      );
    });
  });

  // ─── http ─────────────────────────────────────────────────────────────────

  describe('http()', () => {
    it('calls winston.info with the merged data and correlationId', () => {
      const data = { type: 'request', method: 'GET', path: '/health' };
      logger.http(data);

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          method: 'GET',
          path: '/health',
          correlationId: 'logger-correlation-id',
          service: 'user-service',
        }),
      );
    });

    it('overwrites correlationId from data with the current context correlationId', () => {
      logger.http({ type: 'kafka-produce', correlationId: 'old-id' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'logger-correlation-id' }),
      );
    });
  });

  // ─── NODE_ENV branching ───────────────────────────────────────────────────

  describe('NODE_ENV branching', () => {
    it('creates logger successfully in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const devLogger = new AppLogger();
      devLogger.log('dev log');

      expect(mockWinstonLogger.info).toHaveBeenCalled();
      process.env.NODE_ENV = originalEnv;
    });

    it('creates logger successfully in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodLogger = new AppLogger();
      prodLogger.log('prod log');

      expect(mockWinstonLogger.info).toHaveBeenCalled();
      process.env.NODE_ENV = originalEnv;
    });
  });
});
