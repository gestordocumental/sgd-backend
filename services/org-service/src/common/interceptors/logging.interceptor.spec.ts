import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AppLogger, LoggingInterceptor } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('interceptor-correlation-id'),
}));

const makeContext = (
  method = 'GET',
  path = '/api/orgs',
  ip = '127.0.0.1',
  statusCode = 200,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method, path, ip }),
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const makeHandler = (observable: any): CallHandler => ({
  handle: jest.fn().mockReturnValue(observable),
});

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockLogger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      http: jest.fn(),
    } as any;
    interceptor = new LoggingInterceptor(mockLogger);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs the incoming request before handling', () => {
    const ctx = makeContext('GET', '/api/orgs');
    const handler = makeHandler(of({}));

    interceptor.intercept(ctx, handler).subscribe();

    expect(mockLogger.http).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'request',
        method: 'GET',
        path: '/api/orgs',
        correlationId: 'interceptor-correlation-id',
        message: expect.stringContaining('→ GET /api/orgs'),
      }),
    );
  });

  it('logs the response after a successful handler completion', (done) => {
    const ctx = makeContext('POST', '/api/orgs', '10.0.0.1', 201);
    const handler = makeHandler(of({ id: '123' }));

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(mockLogger.http).toHaveBeenCalledTimes(2);
        const responseCall = mockLogger.http.mock.calls[1][0];
        expect(responseCall).toMatchObject({
          type: 'response',
          method: 'POST',
          path: '/api/orgs',
          statusCode: 201,
          correlationId: 'interceptor-correlation-id',
        });
        expect(responseCall.message).toContain('← POST /api/orgs');
        done();
      },
    });
  });

  it('logs response with error status when handler throws using getStatus()', (done) => {
    const ctx = makeContext('DELETE', '/api/orgs/1', '127.0.0.1', 200);
    const error = { getStatus: jest.fn().mockReturnValue(404), message: 'Not found' };
    const handler = makeHandler(throwError(() => error));

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(mockLogger.http).toHaveBeenCalledTimes(2);
        const responseCall = mockLogger.http.mock.calls[1][0];
        expect(responseCall).toMatchObject({
          type: 'response',
          method: 'DELETE',
          path: '/api/orgs/1',
          statusCode: 404,
        });
        done();
      },
    });
  });

  it('logs response with error.status when getStatus is not available', (done) => {
    const ctx = makeContext('GET', '/api/orgs/bad');
    const error = { status: 422, message: 'Unprocessable' };
    const handler = makeHandler(throwError(() => error));

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const responseCall = mockLogger.http.mock.calls[1][0];
        expect(responseCall).toMatchObject({ statusCode: 422 });
        done();
      },
    });
  });

  it('defaults to status 500 when error has no status info', (done) => {
    const ctx = makeContext('GET', '/api/orgs');
    const error = new Error('Unknown failure');
    const handler = makeHandler(throwError(() => error));

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const responseCall = mockLogger.http.mock.calls[1][0];
        expect(responseCall).toMatchObject({ statusCode: 500 });
        done();
      },
    });
  });

  it('includes duration in the response log', (done) => {
    const ctx = makeContext();
    const handler = makeHandler(of(null));

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const responseCall = mockLogger.http.mock.calls[1][0];
        expect(typeof responseCall.duration).toBe('number');
        expect(responseCall.duration).toBeGreaterThanOrEqual(0);
        done();
      },
    });
  });

  it('passes the value through without modification', (done) => {
    const ctx = makeContext();
    const payload = { id: 'abc', name: 'Acme' };
    const handler = makeHandler(of(payload));

    interceptor.intercept(ctx, handler).subscribe({
      next: (value) => {
        expect(value).toBe(payload);
        done();
      },
    });
  });
});
