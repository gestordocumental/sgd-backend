import { HttpExceptionFilter, AppLogger } from '@sgd/common';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('filter-correlation-id'),
}));

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
    } as unknown as jest.Mocked<AppLogger>;

    filter = new HttpExceptionFilter(mockLogger);
  });

  it('should handle HttpException with structured body', () => {
    const { host, mockStatus, mockJson } = makeHost();
    const exception = new HttpException({ message: 'Not found', resource: 'user' }, HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Not found',
        resource: 'user',
        statusCode: 404,
        correlationId: 'filter-correlation-id',
        path: '/test',
      }),
    );
  });

  it('should handle HttpException with string body', () => {
    const { host, mockStatus, mockJson } = makeHost();
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        correlationId: 'filter-correlation-id',
      }),
    );
  });

  it('should handle non-HttpException as 500', () => {
    const { host, mockStatus } = makeHost();
    const exception = new Error('Unexpected error');

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('GET /test'),
      expect.any(String),
      'HttpExceptionFilter',
    );
  });

  it('should log error for 5xx exceptions', () => {
    const { host } = makeHost('POST', '/auth/login');
    const exception = new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR);

    filter.catch(exception, host);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('POST /auth/login'),
      expect.anything(),
      'HttpExceptionFilter',
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should log warn for 4xx exceptions', () => {
    const { host } = makeHost('GET', '/auth/me');
    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    filter.catch(exception, host);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GET /auth/me → 401'),
      'HttpExceptionFilter',
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('should include timestamp in response', () => {
    const { host, mockJson } = makeHost();
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    );
  });

  it('should handle non-Error non-HttpException objects', () => {
    const { host, mockStatus } = makeHost();

    filter.catch('string exception', host);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      'string exception',
      'HttpExceptionFilter',
    );
  });
});
