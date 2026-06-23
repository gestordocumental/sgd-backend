import { Request, Response } from 'express';
import {
  CorrelationMiddleware,
  CORRELATION_ID_HEADER,
  correlationStorage,
} from '@sgd/common';

function makeReq(headerValue?: string | string[]): Request {
  return {
    headers: headerValue !== undefined ? { [CORRELATION_ID_HEADER]: headerValue } : {},
  } as unknown as Request;
}

function makeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
    _headers: headers,
  } as unknown as Response & { _headers: Record<string, string> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    middleware = new CorrelationMiddleware();
  });

  it('preserves a valid incoming correlation id', () => {
    const req = makeReq('abc-123.XYZ:456');
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(captured).toBe('abc-123.XYZ:456');
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'abc-123.XYZ:456');
  });

  it('generates a UUID when no header is present', () => {
    const req = makeReq();
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(UUID_RE.test(captured)).toBe(true);
  });

  it('generates a UUID when header contains invalid characters', () => {
    const req = makeReq('bad value!@#');
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(UUID_RE.test(captured)).toBe(true);
  });

  it('generates a UUID when header value exceeds 128 characters', () => {
    const req = makeReq('a'.repeat(129));
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(UUID_RE.test(captured)).toBe(true);
  });

  it('accepts header value of exactly 128 valid characters', () => {
    const value = 'a'.repeat(128);
    const req = makeReq(value);
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(captured).toBe(value);
  });

  it('uses first element when header is an array', () => {
    const req = makeReq(['first-id', 'second-id']);
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(captured).toBe('first-id');
  });

  it('generates a UUID when array header first element is invalid', () => {
    const req = makeReq(['bad value!', 'valid']);
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(UUID_RE.test(captured)).toBe(true);
  });

  it('sets the correlation id in the response header', () => {
    const req = makeReq('req-id-001');
    const res = makeRes();

    middleware.use(req, res, () => {});

    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'req-id-001');
  });

  it('calls next()', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID for an empty string header', () => {
    const req = makeReq('');
    const res = makeRes();
    let captured = '';

    middleware.use(req, res, () => {
      captured = correlationStorage.getStore()?.correlationId ?? '';
    });

    expect(UUID_RE.test(captured)).toBe(true);
  });
});
