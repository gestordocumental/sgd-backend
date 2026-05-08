import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';
import { Request, Response, NextFunction } from 'express';

const mockRun = jest.fn((store: unknown, cb: () => void) => cb());

jest.mock('../correlation/correlation.context', () => ({
  correlationStorage: { run: (...args: any[]) => mockRun(...args) },
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('generated-uuid'),
}));

const makeReq = (headers: Record<string, string | string[] | undefined> = {}): Request =>
  ({ headers } as unknown as Request);

const makeRes = (): { res: Response; setHeader: jest.Mock } => {
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return { res, setHeader };
};

const makeNext = (): NextFunction => jest.fn();

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new CorrelationMiddleware();
  });

  it('uses the incoming x-correlation-id header when present', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: 'incoming-id-123' });
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'incoming-id-123');
    expect(mockRun).toHaveBeenCalledWith({ correlationId: 'incoming-id-123' }, expect.any(Function));
  });

  it('generates a UUID when the x-correlation-id header is missing', () => {
    const req = makeReq({});
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
    expect(mockRun).toHaveBeenCalledWith({ correlationId: 'generated-uuid' }, expect.any(Function));
  });

  it('generates a UUID when the header is an empty string', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: '' });
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('generates a UUID when the header is a whitespace-only string', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: '   ' });
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('uses the first element when the header is an array', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: ['array-id-1', 'array-id-2'] });
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'array-id-1');
    expect(mockRun).toHaveBeenCalledWith({ correlationId: 'array-id-1' }, expect.any(Function));
  });

  it('generates a UUID when the array header has an empty first element', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: ['', 'second'] });
    const { res, setHeader } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('calls next() within the async storage context', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: 'ctx-id' });
    const { res } = makeRes();
    const next = makeNext();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('exports CORRELATION_ID_HEADER as "x-correlation-id"', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
