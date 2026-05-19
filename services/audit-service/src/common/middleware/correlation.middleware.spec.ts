import { Request, Response, NextFunction } from 'express';
import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';

function makeReq(correlationId?: string | string[]): Request {
  return { headers: correlationId !== undefined ? { [CORRELATION_ID_HEADER]: correlationId } : {} } as unknown as Request;
}

function makeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers:  headers,
    setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;
  let next:       jest.Mock<NextFunction>;

  beforeEach(() => {
    middleware = new CorrelationMiddleware();
    next       = jest.fn();
  });

  it('passes a valid incoming correlation id through', () => {
    const req = makeReq('valid-corr-id-123');
    const res = makeRes();
    middleware.use(req, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'valid-corr-id-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when no correlation id header is present', () => {
    const req = makeReq();
    const res = makeRes();
    middleware.use(req, res as unknown as Response, next);
    expect(res._headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when correlation id has invalid characters', () => {
    const req = makeReq('invalid id with spaces!');
    const res = makeRes();
    middleware.use(req, res as unknown as Response, next);
    expect(res._headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the first element when header is an array', () => {
    const req = makeReq(['first-id', 'second-id']);
    const res = makeRes();
    middleware.use(req, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'first-id');
  });

  it('generates a UUID when header is an empty string', () => {
    const req = makeReq('');
    const res = makeRes();
    middleware.use(req, res as unknown as Response, next);
    expect(res._headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
