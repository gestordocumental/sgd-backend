import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger, HttpExceptionFilter } from '@sgd/common';

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json, _json: json } as unknown as Response & { status: jest.Mock; _json: jest.Mock };
}

function makeReq(method = 'GET', url = '/api/test'): Request {
  return { method, url, path: url } as unknown as Request;
}

function makeHost(req: Request, res: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    http: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger = makeLogger();
    filter = new HttpExceptionFilter(logger);
  });

  it('handles HttpException with object body', () => {
    const exception = new HttpException({ message: 'Not found', error: 'NotFound' }, HttpStatus.NOT_FOUND);
    const res = makeRes();
    const req = makeReq('GET', '/api/workflows/missing');
    const host = makeHost(req, res);

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.status as jest.Mock).mock.results[0].value;
    expect(body.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        path: '/api/workflows/missing',
      }),
    );
  });

  it('handles HttpException with string message body', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    const res = makeRes();
    const host = makeHost(makeReq(), res);

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(403);
    const jsonArg = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
    expect(jsonArg).toHaveProperty('message');
  });

  it('handles non-HTTP exception as 500', () => {
    const exception = new Error('Unexpected crash');
    const res = makeRes();
    const host = makeHost(makeReq('POST', '/api/workflows'), res);

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('logs error for 5xx exceptions', () => {
    const exception = new HttpException('Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    const res = makeRes();
    const host = makeHost(makeReq('POST', '/api/workflows'), res);

    filter.catch(exception, host);

    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warn for 4xx exceptions', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    const res = makeRes();
    const host = makeHost(makeReq('GET', '/api/test'), res);

    filter.catch(exception, host);

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs error for non-HTTP exceptions (treated as 500)', () => {
    const exception = new Error('Unknown');
    const res = makeRes();
    const host = makeHost(makeReq(), res);

    filter.catch(exception, host);

    expect(logger.error).toHaveBeenCalled();
  });

  it('includes correlationId and timestamp in the response body', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    const res = makeRes();
    const host = makeHost(makeReq(), res);

    filter.catch(exception, host);

    const jsonArg = (res.status as jest.Mock).mock.results[0].value.json.mock.calls[0][0];
    expect(jsonArg).toHaveProperty('correlationId');
    expect(jsonArg).toHaveProperty('timestamp');
    expect(Number.isNaN(Date.parse(jsonArg.timestamp))).toBe(false);
  });
});
