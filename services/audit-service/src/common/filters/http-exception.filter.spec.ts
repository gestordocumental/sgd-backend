import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { AppLogger, HttpExceptionFilter } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeHost(opts: { url?: string; method?: string } = {}): {
  host: ArgumentsHost;
  res: { status: jest.Mock; json: jest.Mock; _body?: unknown };
} {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const urlVal = opts.url ?? '/test';
  const req = { url: urlVal, path: urlVal, method: opts.method ?? 'GET' };
  const host = {
    switchToHttp: () => ({
      getRequest:  () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), debug: jest.fn() } as any;
    filter = new HttpExceptionFilter(logger);
  });

  it('handles HttpException with object response body', () => {
    const { host, res } = makeHost();
    const exception = new HttpException({ message: 'Not found', error: 'Not Found' }, HttpStatus.NOT_FOUND);
    filter.catch(exception, host);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('Not found');
    expect(body.correlationId).toBe('test-corr-id');
  });

  it('handles HttpException with string response body', () => {
    const { host, res } = makeHost();
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    filter.catch(exception, host);
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(403);
    expect(body.message).toBe('Forbidden');
  });

  it('logs warn for 4xx errors', () => {
    const { host } = makeHost({ method: 'POST', url: '/api/test' });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, host);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('POST'),
      'HttpExceptionFilter',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs error and returns 500 for non-HttpException', () => {
    const { host, res } = makeHost({ method: 'GET', url: '/api/fail' });
    const exception = new Error('Something went wrong');
    filter.catch(exception, host);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('GET'),
      expect.any(String),
      'HttpExceptionFilter',
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('handles non-Error 5xx with string message', () => {
    const { host, res } = makeHost();
    filter.catch('string error', host);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
  });

  it('includes path and timestamp in response body', () => {
    const { host, res } = makeHost({ url: '/api/audit' });
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
    const body = res.json.mock.calls[0][0];
    expect(body.path).toBe('/api/audit');
    expect(body.timestamp).toBeDefined();
  });
});
