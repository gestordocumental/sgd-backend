import {
  CorrelationMiddleware,
  CORRELATION_ID_HEADER,
  correlationStorage,
} from '@sgd/common';

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  correlationStorage: {
    run: jest.fn((_store: any, cb: () => void) => cb()),
  },
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('generated-uuid'),
}));

import { randomUUID } from 'crypto';

const mockRun         = correlationStorage.run as jest.MockedFunction<typeof correlationStorage.run>;
const mockRandomUUID  = randomUUID as jest.MockedFunction<typeof randomUUID>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReqRes(headerValue?: string | string[]) {
  const headers: Record<string, string | string[]> = {};
  if (headerValue !== undefined) {
    headers[CORRELATION_ID_HEADER] = headerValue;
  }

  const setHeader = jest.fn();
  const next      = jest.fn();

  const req = { headers } as any;
  const res = { setHeader } as any;

  return { req, res, next, setHeader };
}

// ── CorrelationMiddleware ─────────────────────────────────────────────────────

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockImplementation((_store: any, cb: () => void) => cb());
    middleware = new CorrelationMiddleware();
  });

  it('uses the incoming correlation-id header when present', () => {
    const { req, res, next } = makeReqRes('existing-correlation-id');

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'existing-correlation-id');
    expect(mockRun).toHaveBeenCalledWith(
      { correlationId: 'existing-correlation-id', clientIp: null },
      expect.any(Function),
    );
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it('generates a new UUID when no header is provided', () => {
    const { req, res, next } = makeReqRes();

    middleware.use(req, res, next);

    expect(mockRandomUUID).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
    expect(mockRun).toHaveBeenCalledWith(
      { correlationId: 'generated-uuid', clientIp: null },
      expect.any(Function),
    );
  });

  it('generates a new UUID when the header is an empty string', () => {
    const { req, res, next } = makeReqRes('');

    middleware.use(req, res, next);

    expect(mockRandomUUID).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('generates a new UUID when the header is a whitespace-only string', () => {
    const { req, res, next } = makeReqRes('   ');

    middleware.use(req, res, next);

    expect(mockRandomUUID).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('uses the first element when header is an array', () => {
    const { req, res, next } = makeReqRes(['array-correlation-id', 'second-id']);

    middleware.use(req, res, next);

    expect(mockRandomUUID).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'array-correlation-id');
    expect(mockRun).toHaveBeenCalledWith(
      { correlationId: 'array-correlation-id', clientIp: null },
      expect.any(Function),
    );
  });

  it('generates a new UUID when header array has empty first element', () => {
    const { req, res, next } = makeReqRes(['', 'second-id']);

    middleware.use(req, res, next);

    expect(mockRandomUUID).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('calls next() inside the correlationStorage.run callback', () => {
    const { req, res, next } = makeReqRes('my-id');

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('exports CORRELATION_ID_HEADER as "x-correlation-id"', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
