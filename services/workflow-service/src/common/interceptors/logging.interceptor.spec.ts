import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { AppLogger, LoggingInterceptor } from '@sgd/common';

function makeReq(method = 'GET', path = '/api/test', ip = '127.0.0.1'): Request {
  return { method, path, ip } as unknown as Request;
}

function makeRes(statusCode = 200): Response {
  return { statusCode } as unknown as Response;
}

function makeCtx(req: Request, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    http: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger = makeLogger();
    interceptor = new LoggingInterceptor(logger);
  });

  it('logs the incoming request', (done) => {
    const req = makeReq('POST', '/api/workflows');
    const res = makeRes();
    const ctx = makeCtx(req, res);
    const next: CallHandler = { handle: () => of({ id: 'wf-1' }) };

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(logger.http).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'request', method: 'POST', path: '/api/workflows' }),
        );
        done();
      },
    });
  });

  it('logs the response on success', (done) => {
    const req = makeReq('GET', '/api/workflows/1');
    const res = makeRes(200);
    const ctx = makeCtx(req, res);
    const next: CallHandler = { handle: () => of({ data: [] }) };

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        const calls = (logger.http as jest.Mock).mock.calls;
        const responseLogs = calls.filter((c: [{ type: string }]) => c[0].type === 'response');
        expect(responseLogs.length).toBeGreaterThan(0);
        expect(responseLogs[0][0]).toMatchObject({ type: 'response', method: 'GET' });
        done();
      },
    });
  });

  it('logs the response on error with status from getStatus()', (done) => {
    const req = makeReq('GET', '/api/bad');
    const res = makeRes();
    const ctx = makeCtx(req, res);
    const err = { getStatus: () => 404, message: 'Not found' };
    const next: CallHandler = { handle: () => throwError(() => err) };

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        const calls = (logger.http as jest.Mock).mock.calls;
        const responseLogs = calls.filter((c: [{ type: string }]) => c[0].type === 'response');
        expect(responseLogs.length).toBeGreaterThan(0);
        expect(responseLogs[0][0]).toMatchObject({ statusCode: 404 });
        done();
      },
    });
  });

  it('uses status 500 when error has no getStatus method', (done) => {
    const req = makeReq();
    const res = makeRes();
    const ctx = makeCtx(req, res);
    const err = new Error('Crash');
    const next: CallHandler = { handle: () => throwError(() => err) };

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        const calls = (logger.http as jest.Mock).mock.calls;
        const responseLogs = calls.filter((c: [{ type: string }]) => c[0].type === 'response');
        expect(responseLogs[0][0]).toMatchObject({ statusCode: 500 });
        done();
      },
    });
  });

  it('uses error.status when getStatus is not a function', (done) => {
    const req = makeReq();
    const res = makeRes();
    const ctx = makeCtx(req, res);
    const err = { status: 422, message: 'Unprocessable' };
    const next: CallHandler = { handle: () => throwError(() => err) };

    interceptor.intercept(ctx, next).subscribe({
      error: () => {
        const calls = (logger.http as jest.Mock).mock.calls;
        const responseLogs = calls.filter((c: [{ type: string }]) => c[0].type === 'response');
        expect(responseLogs[0][0]).toMatchObject({ statusCode: 422 });
        done();
      },
    });
  });
});
