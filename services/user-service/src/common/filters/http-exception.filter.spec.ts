import { HttpExceptionFilter, AppLogger } from '@sgd/common';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('filter-correlation-id'),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeHost = (method = 'GET', url = '/test') => {
  const mockJson = jest.fn();
  const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
  const mockRes = { status: mockStatus, json: mockJson };
  const mockReq = { method, url, path: url };
  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => mockReq,
        getResponse: () => mockRes,
      }),
    } as unknown as ArgumentsHost,
    mockStatus,
    mockJson,
    mockReq,
    mockRes,
  };
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockLogger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      http: jest.fn(),
    } as any;
    filter = new HttpExceptionFilter(mockLogger);
  });

  // ─── 4xx HTTP exceptions ──────────────────────────────────────────────────

  describe('4xx HttpException', () => {
    it('responds with the HTTP status code and warns the logger', () => {
      const { host, mockStatus, mockJson } = makeHost('GET', '/users');
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(exception, host);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          correlationId: 'filter-correlation-id',
          path: '/users',
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'GET /users → 404',
        'HttpExceptionFilter',
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('preserves a structured response body (e.g. ConflictException with extra fields)', () => {
      const { host, mockJson } = makeHost('POST', '/users');
      const exception = new HttpException(
        { message: 'Conflict', userId: 'some-id' },
        HttpStatus.CONFLICT,
      );

      filter.catch(exception, host);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'some-id', statusCode: HttpStatus.CONFLICT }),
      );
    });

    it('wraps a plain string response body in a message object', () => {
      const { host, mockJson } = makeHost();
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, host);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Bad Request', statusCode: HttpStatus.BAD_REQUEST }),
      );
    });

    it('includes a timestamp ISO string in the response body', () => {
      const { host, mockJson } = makeHost();
      filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);

      const body = mockJson.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof body.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    });
  });

  // ─── 5xx HTTP exceptions ──────────────────────────────────────────────────

  describe('5xx HttpException', () => {
    it('responds with 500 and logs via error instead of warn', () => {
      const { host, mockStatus } = makeHost('DELETE', '/users/1');
      const exception = new HttpException(
        'Internal Server Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, host);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled exception on DELETE /users/1',
        expect.anything(),
        'HttpExceptionFilter',
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  // ─── Non-HTTP exceptions ──────────────────────────────────────────────────

  describe('non-HttpException', () => {
    it('falls back to 500 for a plain Error', () => {
      const { host, mockStatus, mockJson } = makeHost('GET', '/crash');
      const exception = new Error('Something went wrong');

      filter.catch(exception, host);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled exception on GET /crash',
        exception.stack,
        'HttpExceptionFilter',
      );
    });

    it('falls back to 500 for a non-Error thrown value (string)', () => {
      const { host, mockStatus } = makeHost();

      filter.catch('unexpected string thrown', host);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        'unexpected string thrown',
        'HttpExceptionFilter',
      );
    });

    it('falls back to 500 for null thrown value', () => {
      const { host, mockStatus } = makeHost();

      filter.catch(null, host);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });
});
