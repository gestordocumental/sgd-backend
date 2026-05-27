import { HttpExceptionFilter } from './http-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('filter-correlation-id'),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeHost = (method = 'GET', url = '/test', path = '/test') => {
  const mockJson   = jest.fn();
  const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
  const mockReq    = { method, url, path };
  const mockRes    = { status: mockStatus, json: mockJson };
  const host = {
    switchToHttp: () => ({
      getRequest:  () => mockReq,
      getResponse: () => mockRes,
    }),
  } as unknown as ArgumentsHost;
  return { host, mockStatus, mockJson };
};

const makeLogger = () => ({
  log:   jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
  http:  jest.fn(),
});

// ── HttpExceptionFilter ──────────────────────────────────────────────────────

describe('HttpExceptionFilter', () => {
  it('handles a 400 HttpException with object body — calls warn, not error', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockStatus, mockJson } = makeHost('POST', '/api/test', '/api/test');

    const exception = new HttpException({ message: 'Validation failed', error: 'Bad Request' }, HttpStatus.BAD_REQUEST);
    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode:    400,
        correlationId: 'filter-correlation-id',
        message:       'Validation failed',
      }),
    );
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('handles a 404 HttpException with string body — wraps message in object', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockStatus, mockJson } = makeHost('GET', '/missing', '/missing');

    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Not Found' }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('handles a 500 non-HttpException — calls error logger', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockStatus, mockJson } = makeHost('GET', '/crash', '/crash');

    const exception = new Error('DB connection lost');
    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    );
    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('handles a non-Error object as exception (string thrown)', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockStatus } = makeHost();

    filter.catch('something weird', host);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it('includes correlationId and timestamp in response body', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockJson } = makeHost();

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

    const body = mockJson.mock.calls[0][0];
    expect(body).toHaveProperty('correlationId', 'filter-correlation-id');
    expect(body).toHaveProperty('timestamp');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body).toHaveProperty('path');
  });

  it('handles 401 UnauthorizedException without calling error logger', () => {
    const logger = makeLogger();
    const filter  = new HttpExceptionFilter(logger as any);
    const { host, mockStatus } = makeHost('POST', '/auth', '/auth');

    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
