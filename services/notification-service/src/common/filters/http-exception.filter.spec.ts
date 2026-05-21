import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppLogger } from '../logger/app-logger.service';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeHost(opts: { url?: string; method?: string } = {}): {
  host: ArgumentsHost;
  res: { status: jest.Mock; json: jest.Mock };
} {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const urlVal = opts.url ?? '/test';
  const req = { url: urlVal, path: urlVal, method: opts.method ?? 'GET' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
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

  it('handles HttpException with object body', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException({ message: 'Not found' }, HttpStatus.NOT_FOUND), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].correlationId).toBe('test-corr-id');
  });

  it('handles HttpException with string body', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe('Forbidden');
  });

  it('logs warn for 4xx errors', () => {
    const { host } = makeHost({ method: 'POST' });
    filter.catch(new HttpException('Bad Request', HttpStatus.BAD_REQUEST), host);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs error and returns 500 for non-HttpException', () => {
    const { host, res } = makeHost({ method: 'GET' });
    filter.catch(new Error('Crash'), host);
    expect(logger.error).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('handles non-Error exception', () => {
    const { host, res } = makeHost();
    filter.catch('string error', host);
    expect(res.json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it('includes path and timestamp', () => {
    const { host, res } = makeHost({ url: '/api/notifications' });
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
    const body = res.json.mock.calls[0][0];
    expect(body.path).toBe('/api/notifications');
    expect(body.timestamp).toBeDefined();
  });
});
