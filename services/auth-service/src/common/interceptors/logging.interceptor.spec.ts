import { LoggingInterceptor, AppLogger } from '@sgd/common';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('interceptor-correlation-id'),
}));

const makeContext = (method = 'GET', path = '/test', ip = '127.0.0.1', statusCode = 200) => {
  const mockReq = { method, path, ip };
  const mockRes = { statusCode };
  return {
    switchToHttp: () => ({
      getRequest: () => mockReq,
      getResponse: () => mockRes,
    }),
  } as unknown as ExecutionContext;
};

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
    } as unknown as jest.Mocked<AppLogger>;

    interceptor = new LoggingInterceptor(mockLogger);
  });

  it('should log request on intercept', (done) => {
    const ctx = makeContext('POST', '/auth/login');
    const handler: CallHandler = { handle: () => of({ token: 'abc' }) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'request',
            method: 'POST',
            path: '/auth/login',
            correlationId: 'interceptor-correlation-id',
          }),
        );
        done();
      },
    });
  });

  it('should log response on success', (done) => {
    const ctx = makeContext('GET', '/auth/me', '10.0.0.1', 200);
    const handler: CallHandler = { handle: () => of({ userId: 1 }) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'response',
            method: 'GET',
            path: '/auth/me',
            statusCode: 200,
            duration: expect.any(Number),
          }),
        );
        done();
      },
    });
  });

  it('should log error response using getStatus()', (done) => {
    const ctx = makeContext('POST', '/auth/login');
    const error = { getStatus: () => 401, message: 'Unauthorized' };
    const handler: CallHandler = { handle: () => throwError(() => error) };

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'response',
            statusCode: 401,
            path: '/auth/login',
          }),
        );
        done();
      },
    });
  });

  it('should log error response using err.status when getStatus is not a function', (done) => {
    const ctx = makeContext('DELETE', '/auth/refresh');
    const error = { status: 403, message: 'Forbidden' };
    const handler: CallHandler = { handle: () => throwError(() => error) };

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'response',
            statusCode: 403,
          }),
        );
        done();
      },
    });
  });

  it('should default to statusCode 500 for unknown errors', (done) => {
    const ctx = makeContext('GET', '/auth/me');
    const error = new Error('Unknown error');
    const handler: CallHandler = { handle: () => throwError(() => error) };

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(mockLogger.http).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'response',
            statusCode: 500,
          }),
        );
        done();
      },
    });
  });

  it('should pass through the observable value unchanged', (done) => {
    const ctx = makeContext();
    const responseData = { userId: 42 };
    const handler: CallHandler = { handle: () => of(responseData) };

    interceptor.intercept(ctx, handler).subscribe({
      next: (value) => {
        expect(value).toEqual(responseData);
        done();
      },
    });
  });
});
