import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';
import { correlationStorage } from '../correlation/correlation.context';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('generated-uuid'),
}));

jest.mock('../correlation/correlation.context', () => ({
  correlationStorage: {
    run: jest.fn((store, cb) => cb()),
  },
}));

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new CorrelationMiddleware();
    mockReq = { headers: {} };
    mockRes = { setHeader: jest.fn() };
    mockNext = jest.fn();
  });

  it('should use incoming correlation ID from header', () => {
    mockReq.headers = { [CORRELATION_ID_HEADER]: 'incoming-id-123' };

    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'incoming-id-123');
    expect(correlationStorage.run).toHaveBeenCalledWith(
      { correlationId: 'incoming-id-123' },
      expect.any(Function),
    );
  });

  it('should generate a new UUID when header is missing', () => {
    mockReq.headers = {};

    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(randomUUID).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
    expect(correlationStorage.run).toHaveBeenCalledWith(
      { correlationId: 'generated-uuid' },
      expect.any(Function),
    );
  });

  it('should generate a new UUID when header is empty string', () => {
    mockReq.headers = { [CORRELATION_ID_HEADER]: '   ' };

    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(randomUUID).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'generated-uuid');
  });

  it('should use first element when header is an array', () => {
    mockReq.headers = { [CORRELATION_ID_HEADER]: ['array-id-1', 'array-id-2'] };

    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'array-id-1');
    expect(correlationStorage.run).toHaveBeenCalledWith(
      { correlationId: 'array-id-1' },
      expect.any(Function),
    );
  });

  it('should call next() within correlationStorage context', () => {
    (correlationStorage.run as jest.Mock).mockImplementation((store, cb) => cb());

    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});
