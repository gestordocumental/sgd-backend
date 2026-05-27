import { AppLogger } from './app-logger.service';

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    logger = new AppLogger();
    // Silence winston output during tests
    jest.spyOn((logger as unknown as { winston: { info: jest.Mock; error: jest.Mock; warn: jest.Mock; debug: jest.Mock } }).winston, 'info').mockImplementation(() => logger as unknown as { winston: { info: jest.Mock } });
    jest.spyOn((logger as unknown as { winston: { error: jest.Mock } }).winston, 'error').mockImplementation(() => logger as unknown as { winston: { error: jest.Mock } });
    jest.spyOn((logger as unknown as { winston: { warn: jest.Mock } }).winston, 'warn').mockImplementation(() => logger as unknown as { winston: { warn: jest.Mock } });
    jest.spyOn((logger as unknown as { winston: { debug: jest.Mock } }).winston, 'debug').mockImplementation(() => logger as unknown as { winston: { debug: jest.Mock } });
  });

  it('log() calls winston.info', () => {
    logger.log('Test log message', 'TestContext');
    const winstonInfo = (logger as unknown as { winston: { info: jest.Mock } }).winston.info;
    expect(winstonInfo).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Test log message', context: 'TestContext' }),
    );
  });

  it('error() calls winston.error', () => {
    logger.error('Error message', 'stack-trace', 'TestContext');
    const winstonError = (logger as unknown as { winston: { error: jest.Mock } }).winston.error;
    expect(winstonError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Error message', context: 'TestContext' }),
    );
  });

  it('warn() calls winston.warn', () => {
    logger.warn('Warning message', 'TestContext');
    const winstonWarn = (logger as unknown as { winston: { warn: jest.Mock } }).winston.warn;
    expect(winstonWarn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Warning message' }),
    );
  });

  it('debug() calls winston.debug', () => {
    logger.debug('Debug message', 'TestContext');
    const winstonDebug = (logger as unknown as { winston: { debug: jest.Mock } }).winston.debug;
    expect(winstonDebug).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Debug message' }),
    );
  });

  it('http() calls winston.info with type field', () => {
    logger.http({ type: 'request', method: 'GET', path: '/test' });
    const winstonInfo = (logger as unknown as { winston: { info: jest.Mock } }).winston.info;
    expect(winstonInfo).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'request', method: 'GET' }),
    );
  });

  it('log() uses "App" as default context when not provided', () => {
    logger.log('No context');
    const winstonInfo = (logger as unknown as { winston: { info: jest.Mock } }).winston.info;
    expect(winstonInfo).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'App' }),
    );
  });

  it('includes service name in all log entries', () => {
    logger.log('Some message', 'Ctx');
    const winstonInfo = (logger as unknown as { winston: { info: jest.Mock } }).winston.info;
    expect(winstonInfo).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'workflow-service' }),
    );
  });

  it('includes correlationId in log entries', () => {
    logger.log('With correlation');
    const winstonInfo = (logger as unknown as { winston: { info: jest.Mock } }).winston.info;
    expect(winstonInfo).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: expect.any(String) }),
    );
  });

  it('instantiates without throwing in development mode', () => {
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    expect(() => new AppLogger()).not.toThrow();
    process.env['NODE_ENV'] = originalEnv;
  });

  it('instantiates without throwing in production mode', () => {
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    expect(() => new AppLogger()).not.toThrow();
    process.env['NODE_ENV'] = originalEnv;
  });
});
