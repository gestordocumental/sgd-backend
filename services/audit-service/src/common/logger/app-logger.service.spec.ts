import { AppLogger } from './app-logger.service';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('logger-corr-id'),
}));

describe('AppLogger', () => {
  let logger: AppLogger;

  beforeEach(() => {
    logger = new AppLogger();
  });

  it('log calls winston.info with message and context', () => {
    const spy = jest.spyOn((logger as any).winston, 'info');
    logger.log('test message', 'TestContext');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'test message', context: 'TestContext' }),
    );
  });

  it('error calls winston.error with trace', () => {
    const spy = jest.spyOn((logger as any).winston, 'error');
    logger.error('error msg', 'stack trace here', 'ErrContext');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'error msg', trace: 'stack trace here' }),
    );
  });

  it('warn calls winston.warn with message', () => {
    const spy = jest.spyOn((logger as any).winston, 'warn');
    logger.warn('warning msg', 'WarnContext');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'warning msg' }),
    );
  });

  it('debug calls winston.debug with message', () => {
    const spy = jest.spyOn((logger as any).winston, 'debug');
    logger.debug('debug msg', 'DebugContext');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'debug msg' }),
    );
  });

  it('http calls winston.info with data and correlationId', () => {
    const spy = jest.spyOn((logger as any).winston, 'info');
    logger.http({ type: 'request', method: 'GET' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'request', method: 'GET', correlationId: 'logger-corr-id' }),
    );
  });

  it('uses default context App when none is provided', () => {
    const spy = jest.spyOn((logger as any).winston, 'info');
    logger.log('no context');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'App' }),
    );
  });

  describe('development environment', () => {
    const original = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = original;
    });

    it('creates a dev-format logger when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      const devLogger = new AppLogger();
      expect(devLogger).toBeDefined();
    });
  });
});
