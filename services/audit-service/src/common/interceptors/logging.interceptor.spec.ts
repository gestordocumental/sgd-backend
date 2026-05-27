import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AppLogger, LoggingInterceptor } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeCtx(req: Partial<{ method: string; path: string; ip: string }> = {}): ExecutionContext {
  const res = { statusCode: 200 };
  const request = { method: 'GET', path: '/test', ip: '127.0.0.1', ...req };
  return {
    switchToHttp: () => ({
      getRequest:  () => request,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger      = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() } as any;
    interceptor = new LoggingInterceptor(logger);
  });

  it('logs the incoming request', (done) => {
    const ctx     = makeCtx({ method: 'GET', path: '/api/test' });
    const handler: CallHandler = { handle: () => of({ data: 'ok' }) };
    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'request', method: 'GET' }),
        );
        done();
      },
    });
  });

  it('logs the response on success', (done) => {
    const ctx     = makeCtx({ method: 'POST', path: '/api/audit' });
    const handler: CallHandler = { handle: () => of({}) };
    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'response', statusCode: 200 }),
        );
        done();
      },
    });
  });

  it('logs the response on error with getStatus()', (done) => {
    const err     = { getStatus: () => 400 };
    const ctx     = makeCtx({ method: 'GET', path: '/api/fail' });
    const handler: CallHandler = { handle: () => throwError(() => err) };
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'response', statusCode: 400 }),
        );
        done();
      },
    });
  });

  it('uses status property when getStatus is not a function', (done) => {
    const err     = { status: 422 };
    const ctx     = makeCtx();
    const handler: CallHandler = { handle: () => throwError(() => err) };
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 422 }),
        );
        done();
      },
    });
  });

  it('falls back to 500 for plain Error objects', (done) => {
    const err     = new Error('Unknown error');
    const ctx     = makeCtx();
    const handler: CallHandler = { handle: () => throwError(() => err) };
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 500 }),
        );
        done();
      },
    });
  });
});
