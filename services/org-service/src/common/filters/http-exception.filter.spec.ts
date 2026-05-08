import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppLogger } from '../logger/app-logger.service';

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('filter-correlation-id'),
}));

const makeHost = (
  method = 'GET',
  url = '/test',
  path = '/test',
): { host: ArgumentsHost; mockStatus: jest.Mock; mockJson: jest.Mock } => {
  const mockJson = jest.fn();
  const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method, url, path }),
      getResponse: () => ({ status: mockStatus, json: mockJson }),
    }),
  } as unknown as ArgumentsHost;
  return { host, mockStatus, mockJson };
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
    } as any;
    filter = new HttpExceptionFilter(mockLogger);
  });

  afterEach(() => jest.clearAllMocks());

  it('handles an HttpException with an object body and sets correct status', () => {
    const { host, mockStatus, mockJson } = makeHost('GET', '/api/orgs', '/api/orgs');
    const exception = new HttpException({ message: 'Not found', error: 'Not Found' }, HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        correlationId: 'filter-correlation-id',
        path: '/api/orgs',
        message: 'Not found',
      }),
    );
  });

  it('handles an HttpException with a string body', () => {
    const { host, mockStatus, mockJson } = makeHost('POST', '/api/orgs', '/api/orgs');
    const exception = new HttpException('Conflict occurred', HttpStatus.CONFLICT);

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        message: 'Conflict occurred',
      }),
    );
  });

  it('handles a non-HTTP exception as 500 Internal Server Error', () => {
    const { host, mockStatus, mockJson } = makeHost('GET', '/api/orgs', '/api/orgs');
    const exception = new Error('Unexpected failure');

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('logs error for 5xx exceptions', () => {
    const { host } = makeHost('DELETE', '/api/orgs/1', '/api/orgs/1');
    const exception = new HttpException('Server error', HttpStatus.INTERNAL_SERVER_ERROR);

    filter.catch(exception, host);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      expect.anything(),
      'HttpExceptionFilter',
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('logs warn for 4xx exceptions', () => {
    const { host } = makeHost('GET', '/api/orgs/missing', '/api/orgs/missing');
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('404'),
      'HttpExceptionFilter',
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('includes correlationId and timestamp in every response', () => {
    const { host, mockJson } = makeHost();
    const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    const body = mockJson.mock.calls[0][0];
    expect(body).toHaveProperty('correlationId', 'filter-correlation-id');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
  });

  it('handles a non-Error object thrown as exception', () => {
    const { host, mockStatus } = makeHost();
    filter.catch('string error thrown', host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      'string error thrown',
      'HttpExceptionFilter',
    );
  });

  it('handles a 500 HttpException and logs its stack', () => {
    const { host } = makeHost('PATCH', '/api/orgs/1', '/api/orgs/1');
    const exception = new HttpException('Internal', HttpStatus.INTERNAL_SERVER_ERROR);

    filter.catch(exception, host);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unhandled exception on PATCH /api/orgs/1',
      exception.stack,
      'HttpExceptionFilter',
    );
  });
});
