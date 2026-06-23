import { AppLogger } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

describe('AppLogger', () => {
  let logger: AppLogger;
  let winstonInfo:  jest.SpyInstance;
  let winstonError: jest.SpyInstance;
  let winstonWarn:  jest.SpyInstance;
  let winstonDebug: jest.SpyInstance;

  beforeEach(() => {
    logger = new AppLogger();
    const win = (logger as any).winston;
    winstonInfo  = jest.spyOn(win, 'info').mockImplementation(() => {});
    winstonError = jest.spyOn(win, 'error').mockImplementation(() => {});
    winstonWarn  = jest.spyOn(win, 'warn').mockImplementation(() => {});
    winstonDebug = jest.spyOn(win, 'debug').mockImplementation(() => {});
  });

  it('log() calls winston.info with message and context', () => {
    logger.log('hello', 'TestCtx');
    expect(winstonInfo).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello', context: 'TestCtx' }));
  });

  it('log() uses "App" as default context', () => {
    logger.log('hello');
    expect(winstonInfo).toHaveBeenCalledWith(expect.objectContaining({ context: 'App' }));
  });

  it('error() calls winston.error', () => {
    logger.error('oops', 'stack-trace', 'ErrCtx');
    expect(winstonError).toHaveBeenCalledWith(expect.objectContaining({ message: 'oops', trace: 'stack-trace' }));
  });

  it('warn() calls winston.warn', () => {
    logger.warn('careful', 'WarnCtx');
    expect(winstonWarn).toHaveBeenCalledWith(expect.objectContaining({ message: 'careful' }));
  });

  it('debug() calls winston.debug', () => {
    logger.debug('dbg msg');
    expect(winstonDebug).toHaveBeenCalledWith(expect.objectContaining({ message: 'dbg msg' }));
  });

  it('http() calls winston.info with provided data', () => {
    logger.http({ type: 'request', method: 'GET', path: '/api/test' });
    expect(winstonInfo).toHaveBeenCalledWith(expect.objectContaining({ type: 'request', method: 'GET' }));
  });

  it('includes correlationId in all log calls', () => {
    logger.log('msg');
    expect(winstonInfo).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'test-corr-id' }));
  });
});
