import { AppLogger } from './app-logger.service';
import * as correlationContext from '../correlation/correlation.context';
import * as winston from 'winston';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  return {
    createLogger: jest.fn().mockReturnValue(mockLogger),
    format: {
      combine: jest.fn().mockReturnValue({}),
      colorize: jest.fn().mockReturnValue({}),
      timestamp: jest.fn().mockReturnValue({}),
      printf: jest.fn().mockReturnValue({}),
      errors: jest.fn().mockReturnValue({}),
      json: jest.fn().mockReturnValue({}),
    },
    transports: {
      Console: jest.fn().mockImplementation(() => ({})),
    },
  };
});

describe('AppLogger', () => {
  let logger: AppLogger;
  let mockWinstonLogger: { info: jest.Mock; error: jest.Mock; warn: jest.Mock; debug: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWinstonLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    (winston.createLogger as jest.Mock).mockReturnValue(mockWinstonLogger);
    logger = new AppLogger();
  });

  describe('constructor', () => {
    it('should create a winston logger', () => {
      expect(winston.createLogger).toHaveBeenCalled();
    });

    it('should use debug level in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      new AppLogger();
      const callArgs = (winston.createLogger as jest.Mock).mock.calls.at(-1)[0];
      expect(callArgs.level).toBe('debug');
      process.env.NODE_ENV = originalEnv;
    });

    it('should use info level in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      new AppLogger();
      const callArgs = (winston.createLogger as jest.Mock).mock.calls.at(-1)[0];
      expect(callArgs.level).toBe('info');
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('log', () => {
    it('should call winston.info with correct payload', () => {
      logger.log('test message', 'TestContext');
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'test message',
          context: 'TestContext',
          correlationId: 'test-correlation-id',
          service: 'auth-service',
        }),
      );
    });

    it('should use default context "App" when not provided', () => {
      logger.log('test message');
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  describe('error', () => {
    it('should call winston.error with trace', () => {
      logger.error('error message', 'stack trace', 'ErrorContext');
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'error message',
          context: 'ErrorContext',
          correlationId: 'test-correlation-id',
          service: 'auth-service',
          trace: 'stack trace',
        }),
      );
    });
  });

  describe('warn', () => {
    it('should call winston.warn with correct payload', () => {
      logger.warn('warn message', 'WarnContext');
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'warn message',
          context: 'WarnContext',
          correlationId: 'test-correlation-id',
          service: 'auth-service',
        }),
      );
    });
  });

  describe('debug', () => {
    it('should call winston.debug with correct payload', () => {
      logger.debug('debug message', 'DebugContext');
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          message: 'debug message',
          context: 'DebugContext',
          correlationId: 'test-correlation-id',
          service: 'auth-service',
        }),
      );
    });
  });

  describe('http', () => {
    it('should call winston.info with merged data and correlationId', () => {
      logger.http({ type: 'request', method: 'GET', path: '/health' });
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          method: 'GET',
          path: '/health',
          correlationId: 'test-correlation-id',
          service: 'auth-service',
        }),
      );
    });
  });
});
