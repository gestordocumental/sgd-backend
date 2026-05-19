import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { HttpException, HttpStatus } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';
import { AppLogger } from '../logger/app-logger.service';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeCtx(method = 'GET', path = '/api/test', ip = '127.0.0.1'): ExecutionContext {
  const req = { method, path, ip };
  const res = { statusCode: 200 };
  return {
    switchToHttp: () => ({
      getRequest:  () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(obs: any): CallHandler {
  return { handle: jest.fn().mockReturnValue(obs) };
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn() } as any;
    interceptor = new LoggingInterceptor(logger);
  });

  it('logs the incoming request', () => {
    const ctx     = makeCtx();
    const handler = makeHandler(of({}));
    interceptor.intercept(ctx, handler).subscribe();
    expect(logger.http).toHaveBeenCalledWith(expect.objectContaining({ type: 'request', method: 'GET' }));
  });

  it('logs successful response', (done) => {
    const ctx     = makeCtx('POST', '/api/test');
    const handler = makeHandler(of({ id: 1 }));
    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(logger.http).toHaveBeenCalledTimes(2);
        expect(logger.http).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'response', method: 'POST' }));
        done();
      },
    });
  });

  it('logs error response with getStatus()', (done) => {
    const err     = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    const ctx     = makeCtx();
    const handler = makeHandler(throwError(() => err));
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'response', statusCode: 404 }));
        done();
      },
    });
  });

  it('logs error response with status property fallback', (done) => {
    const err     = { status: 503 };
    const ctx     = makeCtx();
    const handler = makeHandler(throwError(() => err));
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 503 }));
        done();
      },
    });
  });

  it('logs 500 when error has no status info', (done) => {
    const ctx     = makeCtx();
    const handler = makeHandler(throwError(() => new Error('boom')));
    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(logger.http).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 500 }));
        done();
      },
    });
  });
});
