import { AppLogger } from './app-logger.service';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('logger-correlation-id'),
}));

// Capture winston log calls without actually writing to console
const mockWinstonInfo  = jest.fn();
const mockWinstonError = jest.fn();
const mockWinstonWarn  = jest.fn();
const mockWinstonDebug = jest.fn();

jest.mock('winston', () => {
  const actualWinston = jest.requireActual('winston');
  return {
    ...actualWinston,
    createLogger: jest.fn().mockReturnValue({
      info:  (...args: any[]) => mockWinstonInfo(...args),
      error: (...args: any[]) => mockWinstonError(...args),
      warn:  (...args: any[]) => mockWinstonWarn(...args),
      debug: (...args: any[]) => mockWinstonDebug(...args),
    }),
  };
});

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new AppLogger();
  });

  describe('log()', () => {
    it('calls winston.info with a structured object including correlationId and service', () => {
      logger.log('Application started', 'Bootstrap');

      expect(mockWinstonInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'Application started',
          context: 'Bootstrap',
          correlationId: 'logger-correlation-id',
          service: 'org-service',
        }),
      );
    });

    it('defaults context to "App" when not provided', () => {
      logger.log('No context message');

      expect(mockWinstonInfo).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  describe('error()', () => {
    it('calls winston.error with trace and structured metadata', () => {
      logger.error('Something failed', 'Error stack trace', 'ErrorContext');

      expect(mockWinstonError).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Something failed',
          context: 'ErrorContext',
          correlationId: 'logger-correlation-id',
          service: 'org-service',
          trace: 'Error stack trace',
        }),
      );
    });

    it('accepts undefined trace without throwing', () => {
      expect(() => logger.error('Fail', undefined, 'Ctx')).not.toThrow();
      expect(mockWinstonError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Fail' }),
      );
    });
  });

  describe('warn()', () => {
    it('calls winston.warn with the correct structure', () => {
      logger.warn('Deprecation notice', 'WarnContext');

      expect(mockWinstonWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'Deprecation notice',
          context: 'WarnContext',
          correlationId: 'logger-correlation-id',
        }),
      );
    });
  });

  describe('debug()', () => {
    it('calls winston.debug with the correct structure', () => {
      logger.debug('Debug info', 'DebugCtx');

      expect(mockWinstonDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          message: 'Debug info',
          context: 'DebugCtx',
        }),
      );
    });
  });

  describe('http()', () => {
    it('calls winston.info with the provided data merged with correlationId and service', () => {
      logger.http({
        type: 'request',
        method: 'GET',
        path: '/api/orgs',
        message: '→ GET /api/orgs',
      });

      expect(mockWinstonInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          method: 'GET',
          path: '/api/orgs',
          correlationId: 'logger-correlation-id',
          service: 'org-service',
        }),
      );
    });

    it('allows caller-provided correlationId to be overridden by getCorrelationId()', () => {
      logger.http({ correlationId: 'caller-id', message: 'test' });

      // The implementation spreads data first then sets correlationId from context
      expect(mockWinstonInfo).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'logger-correlation-id' }),
      );
    });
  });

  describe('NODE_ENV variations', () => {
    it('creates a logger in development mode without throwing', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      expect(() => new AppLogger()).not.toThrow();
      process.env.NODE_ENV = originalEnv;
    });

    it('creates a logger in production mode without throwing', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      expect(() => new AppLogger()).not.toThrow();
      process.env.NODE_ENV = originalEnv;
    });
  });
});
