import { AppLogger } from './app-logger.service';

// ── Module-level mock for winston and correlation context ─────────────────────

const mockInfo  = jest.fn();
const mockError = jest.fn();
const mockWarn  = jest.fn();
const mockDebug = jest.fn();

jest.mock('winston', () => {
  const actualWinston = jest.requireActual('winston');
  return {
    ...actualWinston,
    createLogger: jest.fn().mockReturnValue({
      info:  (...args: any[]) => mockInfo(...args),
      error: (...args: any[]) => mockError(...args),
      warn:  (...args: any[]) => mockWarn(...args),
      debug: (...args: any[]) => mockDebug(...args),
    }),
  };
});

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

import { getCorrelationId } from '../correlation/correlation.context';

const mockGetCorrelationId = getCorrelationId as jest.MockedFunction<typeof getCorrelationId>;

// ── AppLogger ─────────────────────────────────────────────────────────────────

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new AppLogger();
  });

  describe('log()', () => {
    it('calls winston.info with the correct structure', () => {
      logger.log('Test message', 'TestContext');

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          level:         'info',
          message:       'Test message',
          context:       'TestContext',
          correlationId: 'test-correlation-id',
          service:       'metadata-extractor-service',
        }),
      );
    });

    it('uses "App" as default context when context is omitted', () => {
      logger.log('No context message');

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  describe('error()', () => {
    it('calls winston.error with message and trace', () => {
      logger.error('Error occurred', 'stack-trace', 'ErrorContext');

      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({
          level:   'error',
          message: 'Error occurred',
          context: 'ErrorContext',
          trace:   'stack-trace',
        }),
      );
    });

    it('uses "App" as default context when context is omitted', () => {
      logger.error('error without context');

      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'App' }),
      );
    });
  });

  describe('warn()', () => {
    it('calls winston.warn with the correct structure', () => {
      logger.warn('Warning message', 'WarnContext');

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          level:   'warn',
          message: 'Warning message',
          context: 'WarnContext',
        }),
      );
    });
  });

  describe('debug()', () => {
    it('calls winston.debug with the correct structure', () => {
      logger.debug('Debug message', 'DebugContext');

      expect(mockDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          level:   'debug',
          message: 'Debug message',
          context: 'DebugContext',
        }),
      );
    });
  });

  describe('http()', () => {
    it('calls winston.info with the provided data and appended correlationId and service', () => {
      logger.http({ type: 'kafka-produce', topic: 'some-topic' });

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          type:          'kafka-produce',
          topic:         'some-topic',
          correlationId: 'test-correlation-id',
          service:       'metadata-extractor-service',
        }),
      );
    });

    it('reads the current correlationId at call time', () => {
      mockGetCorrelationId.mockReturnValueOnce('dynamic-correlation-id');

      logger.http({ event: 'test-event' });

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'dynamic-correlation-id' }),
      );
    });
  });

  describe('build() (via log)', () => {
    it('includes correlationId from correlation context', () => {
      mockGetCorrelationId.mockReturnValueOnce('specific-id');

      logger.log('Message with specific correlation');

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'specific-id' }),
      );
    });

    it('always includes service name', () => {
      logger.log('any message');

      expect(mockInfo).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'metadata-extractor-service' }),
      );
    });
  });

  describe('NODE_ENV modes', () => {
    it('constructs without throwing in production mode', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      expect(() => new AppLogger()).not.toThrow();
      process.env.NODE_ENV = original;
    });

    it('constructs without throwing in development mode', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      expect(() => new AppLogger()).not.toThrow();
      process.env.NODE_ENV = original;
    });
  });
});
