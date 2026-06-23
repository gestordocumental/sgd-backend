import { LoggingInterceptor } from '@sgd/common';
import { of, throwError } from 'rxjs';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('interceptor-correlation-id'),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeLogger = () => ({
  log:   jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
  http:  jest.fn(),
});

function makeContext(method = 'GET', path = '/test', ip = '127.0.0.1', statusCode = 200) {
  const mockReq = { method, path, ip };
  const mockRes = { statusCode };
  return {
    switchToHttp: () => ({
      getRequest:  () => mockReq,
      getResponse: () => mockRes,
    }),
  } as any;
}

// ── LoggingInterceptor ───────────────────────────────────────────────────────

describe('LoggingInterceptor', () => {
  it('logs http request on intercept', () => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext('GET', '/api/test');
    const next        = { handle: () => of({ data: 'ok' }) } as any;

    interceptor.intercept(ctx, next).subscribe();

    expect(logger.http).toHaveBeenCalledWith(
      expect.objectContaining({
        type:          'request',
        method:        'GET',
        path:          '/api/test',
        correlationId: 'interceptor-correlation-id',
      }),
    );
  });

  it('logs http response on successful completion', (done) => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext('POST', '/api/items', '10.0.0.1', 201);
    const next        = { handle: () => of({ id: 1 }) } as any;

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(logger.http).toHaveBeenCalledTimes(2);
        const responseCall = logger.http.mock.calls[1][0];
        expect(responseCall.type).toBe('response');
        expect(responseCall.method).toBe('POST');
        expect(responseCall.path).toBe('/api/items');
        expect(responseCall).toHaveProperty('duration');
        done();
      },
    });
  });

  it('logs http response with error status on observable error', (done) => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext('DELETE', '/api/items/1');
    const httpError   = { getStatus: () => 404, message: 'Not Found' };
    const next        = { handle: () => throwError(() => httpError) } as any;

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenCalledTimes(2);
        const responseCall = logger.http.mock.calls[1][0];
        expect(responseCall.type).toBe('response');
        expect(responseCall.statusCode).toBe(404);
        done();
      },
    });
  });

  it('falls back to 500 status when error has no getStatus()', (done) => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext('PUT', '/api/crash');
    const plainError  = new Error('Unexpected failure');
    const next        = { handle: () => throwError(() => plainError) } as any;

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        const responseCall = logger.http.mock.calls[1][0];
        expect(responseCall.statusCode).toBe(500);
        done();
      },
    });
  });

  it('falls back to err.status when err.getStatus is not a function', (done) => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext('GET', '/api/items');
    const errorWithStatus = { status: 503 };
    const next        = { handle: () => throwError(() => errorWithStatus) } as any;

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        const responseCall = logger.http.mock.calls[1][0];
        expect(responseCall.statusCode).toBe(503);
        done();
      },
    });
  });

  it('returns an Observable from intercept()', () => {
    const logger      = makeLogger();
    const interceptor = new LoggingInterceptor(logger as any);
    const ctx         = makeContext();
    const next        = { handle: () => of(null) } as any;

    const result = interceptor.intercept(ctx, next);
    expect(result).toBeDefined();
    expect(typeof result.subscribe).toBe('function');
  });
});
