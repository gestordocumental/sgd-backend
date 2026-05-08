import { Request, Response, NextFunction } from 'express';
import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';
import { correlationStorage } from '../correlation/correlation.context';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReq(correlationId?: string | string[]): Partial<Request> {
  const headers: Record<string, string | string[]> = {};
  if (correlationId !== undefined) {
    headers[CORRELATION_ID_HEADER] = correlationId;
  }
  return { headers } as unknown as Partial<Request>;
}

function makeRes(): { setHeader: jest.Mock; res: Partial<Response> } {
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Partial<Response>;
  return { setHeader, res };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new CorrelationMiddleware();
    next = jest.fn();
  });

  // ─── Header propagation ───────────────────────────────────────────────────

  it('echoes the x-correlation-id header back in the response', () => {
    const { setHeader, res } = makeRes();
    const req = makeReq('my-correlation-id');

    middleware.use(req as Request, res as Response, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'my-correlation-id');
  });

  it('generates a UUID and sets it when no x-correlation-id header is present', () => {
    const { setHeader, res } = makeRes();
    const req = makeReq(); // no header

    middleware.use(req as Request, res as Response, next);

    const receivedId = setHeader.mock.calls[0][1] as string;
    expect(typeof receivedId).toBe('string');
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(receivedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates a UUID when the header value is an empty string', () => {
    const { setHeader, res } = makeRes();
    const req = makeReq('   '); // whitespace only

    middleware.use(req as Request, res as Response, next);

    const receivedId = setHeader.mock.calls[0][1] as string;
    expect(receivedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('uses the first element when x-correlation-id is an array', () => {
    const { setHeader, res } = makeRes();
    const req = makeReq(['first-id', 'second-id']);

    middleware.use(req as Request, res as Response, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'first-id');
  });

  // ─── Next function ────────────────────────────────────────────────────────

  it('calls next() to continue the middleware chain', () => {
    const { res } = makeRes();
    const req = makeReq('test-id');

    middleware.use(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  // ─── AsyncLocalStorage context ────────────────────────────────────────────

  it('provides the correlationId inside the AsyncLocalStorage context when next() runs', (done) => {
    const { res } = makeRes();
    const req = makeReq('als-test-id');

    const nextWithCheck: NextFunction = () => {
      const stored = correlationStorage.getStore();
      expect(stored?.correlationId).toBe('als-test-id');
      done();
    };

    middleware.use(req as Request, res as Response, nextWithCheck);
  });

  it('provides a generated UUID inside the AsyncLocalStorage context when no header', (done) => {
    const { res } = makeRes();
    const req = makeReq();

    const nextWithCheck: NextFunction = () => {
      const stored = correlationStorage.getStore();
      expect(stored?.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      done();
    };

    middleware.use(req as Request, res as Response, nextWithCheck);
  });

  it('each request gets an independent correlationId', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 5; i++) {
      const { res } = makeRes();
      const req = makeReq();
      middleware.use(req as Request, res as Response, () => {
        const stored = correlationStorage.getStore();
        if (stored?.correlationId) ids.add(stored.correlationId);
      });
    }

    expect(ids.size).toBe(5);
  });
});
