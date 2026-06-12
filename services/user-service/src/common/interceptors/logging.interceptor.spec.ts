import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor, AppLogger } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('intercept-correlation-id'),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeContext(method = 'GET', path = '/test', ip = '127.0.0.1', statusCode = 200): ExecutionContext {
  const req = { method, path, ip };
  const res = { statusCode };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(observable: Parameters<typeof of>[0] | Error): CallHandler {
  return {
    handle: () =>
      observable instanceof Error ? throwError(() => observable) : of(observable),
  };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

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

  // ─── Incoming request logging ─────────────────────────────────────────────

  it('logs the incoming request before handling', (done) => {
    const ctx = makeContext('POST', '/users');
    const handler = makeHandler({ id: 1 });

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'request',
            method: 'POST',
            path: '/users',
            correlationId: 'intercept-correlation-id',
          }),
        );
        done();
      },
    });
  });

  // ─── Successful response logging ──────────────────────────────────────────

  it('logs the outgoing response on success', (done) => {
    const ctx = makeContext('GET', '/users', '10.0.0.1', 200);
    const handler = makeHandler({ data: 'ok' });

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const calls = mockLogger.http.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const responselog = calls.find((c: Record<string, unknown>) => c['type'] === 'response');
        expect(responselog).toBeDefined();
        expect(responselog).toMatchObject({
          type: 'response',
          method: 'GET',
          path: '/users',
          statusCode: 200,
          correlationId: 'intercept-correlation-id',
        });
        expect(typeof responselog!['duration']).toBe('number');
        done();
      },
    });
  });

  it('passes through the original response value unchanged', (done) => {
    const ctx = makeContext();
    const payload = { users: [] };
    const handler = makeHandler(payload);

    interceptor.intercept(ctx, handler).subscribe({
      next: (value: unknown) => {
        expect(value).toEqual(payload);
      },
      complete: () => done(),
    });
  });

  // ─── Error response logging ───────────────────────────────────────────────

  it('logs the response with the error status code on failure', (done) => {
    const ctx = makeContext('DELETE', '/users/1');
    const err = Object.assign(new Error('Not found'), { getStatus: () => 404 });
    const handler = makeHandler(err as unknown as Error);

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const calls = mockLogger.http.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const responseLog = calls.find((c: Record<string, unknown>) => c['type'] === 'response');
        expect(responseLog).toMatchObject({
          type: 'response',
          method: 'DELETE',
          path: '/users/1',
          statusCode: 404,
        });
        done();
      },
    });
  });

  it('falls back to 500 when the error has no getStatus method', (done) => {
    const ctx = makeContext('GET', '/crash');
    const err = new Error('Crash');
    const handler = makeHandler(err);

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const calls = mockLogger.http.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const responseLog = calls.find((c: Record<string, unknown>) => c['type'] === 'response');
        expect(responseLog).toMatchObject({ statusCode: 500 });
        done();
      },
    });
  });

  it('uses err.status when getStatus is not a function', (done) => {
    const ctx = makeContext('PATCH', '/orgs/1');
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    const handler = makeHandler(err as unknown as Error);

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const calls = mockLogger.http.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const responseLog = calls.find((c: Record<string, unknown>) => c['type'] === 'response');
        expect(responseLog).toMatchObject({ statusCode: 403 });
        done();
      },
    });
  });

  it('re-throws the error after logging so downstream handlers receive it', (done) => {
    const ctx = makeContext();
    const originalError = new Error('boom');
    const handler = makeHandler(originalError);

    interceptor.intercept(ctx, handler).subscribe({
      error: (err: unknown) => {
        expect(err).toBe(originalError);
        done();
      },
    });
  });

  it('includes the client IP in the request log', (done) => {
    const ctx = makeContext('GET', '/health', '192.168.1.10');
    const handler = makeHandler(null);

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const calls = mockLogger.http.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
        const requestLog = calls.find((c: Record<string, unknown>) => c['type'] === 'request');
        expect(requestLog).toMatchObject({ ip: '192.168.1.10' });
        done();
      },
    });
  });
});
