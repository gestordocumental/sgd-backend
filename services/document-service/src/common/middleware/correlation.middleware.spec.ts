import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';
import { correlationStorage } from '../correlation/correlation.context';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReqRes(headers: Record<string, string | string[] | undefined> = {}) {
  const setHeader = jest.fn();
  const req = { headers } as any;
  const res = { setHeader }  as any;
  const next = jest.fn();
  return { req, res, next, setHeader };
}

// ── CorrelationMiddleware ────────────────────────────────────────────────────

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    middleware = new CorrelationMiddleware();
  });

  it('uses the incoming x-correlation-id header when provided', (done) => {
    const { req, res, next, setHeader } = makeReqRes({ [CORRELATION_ID_HEADER]: 'my-correlation-123' });

    jest.spyOn(correlationStorage, 'run').mockImplementation((_store, cb) => cb());

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'my-correlation-123');
    expect(next).toHaveBeenCalled();
    done();
  });

  it('generates a new UUID when no x-correlation-id header is present', (done) => {
    const { req, res, next, setHeader } = makeReqRes({});

    jest.spyOn(correlationStorage, 'run').mockImplementation((_store, cb) => cb());

    middleware.use(req, res, next);

    const calledWith = setHeader.mock.calls[0][1] as string;
    expect(calledWith).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(next).toHaveBeenCalled();
    done();
  });

  it('generates a new UUID when x-correlation-id is an empty string', (done) => {
    const { req, res, next, setHeader } = makeReqRes({ [CORRELATION_ID_HEADER]: '' });

    jest.spyOn(correlationStorage, 'run').mockImplementation((_store, cb) => cb());

    middleware.use(req, res, next);

    const calledWith = setHeader.mock.calls[0][1] as string;
    // Should be a UUID, not an empty string
    expect(calledWith).not.toBe('');
    expect(calledWith.length).toBeGreaterThan(10);
    done();
  });

  it('generates a new UUID when x-correlation-id is a whitespace string', (done) => {
    const { req, res, next, setHeader } = makeReqRes({ [CORRELATION_ID_HEADER]: '   ' });

    jest.spyOn(correlationStorage, 'run').mockImplementation((_store, cb) => cb());

    middleware.use(req, res, next);

    const calledWith = setHeader.mock.calls[0][1] as string;
    expect(calledWith.trim()).not.toBe('');
    expect(calledWith).toMatch(/^[0-9a-f-]{36}$/i);
    done();
  });

  it('picks first element when x-correlation-id is an array', (done) => {
    const { req, res, next, setHeader } = makeReqRes({
      [CORRELATION_ID_HEADER]: ['first-id', 'second-id'],
    });

    jest.spyOn(correlationStorage, 'run').mockImplementation((_store, cb) => cb());

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'first-id');
    done();
  });

  it('runs next() inside correlationStorage.run with the correlationId store', (done) => {
    const { req, res } = makeReqRes({ [CORRELATION_ID_HEADER]: 'test-cid' });
    const next = jest.fn();
    const runSpy = jest.spyOn(correlationStorage, 'run').mockImplementation((store, cb) => {
      expect(store).toEqual(expect.objectContaining({ correlationId: 'test-cid', clientIp: null }));
      cb();
    });

    middleware.use(req, res, next);

    expect(runSpy).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    done();
  });
});
