import { CorrelationMiddleware, CORRELATION_ID_HEADER } from './correlation.middleware';
import { correlationStorage } from '../correlation/correlation.context';

function makeReqRes(headers: Record<string, string | string[]> = {}) {
  const req = { headers } as any;
  const res = { setHeader: jest.fn() } as any;
  return { req, res };
}

describe('CorrelationMiddleware', () => {
  const middleware = new CorrelationMiddleware();

  it('passes through a valid correlation ID', (done) => {
    const { req, res } = makeReqRes({ [CORRELATION_ID_HEADER]: 'my-valid-id' });
    middleware.use(req, res, () => {
      correlationStorage.getStore()?.correlationId === 'my-valid-id'
        ? done()
        : done(new Error('wrong correlation id'));
    });
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'my-valid-id');
  });

  it('generates a UUID when header is missing', (done) => {
    const { req, res } = makeReqRes();
    middleware.use(req, res, () => {
      const id = correlationStorage.getStore()?.correlationId ?? '';
      const uuidPattern = /^[0-9a-f-]{36}$/i;
      uuidPattern.test(id) ? done() : done(new Error(`not a UUID: ${id}`));
    });
  });

  it('generates a UUID when header is an empty string', (done) => {
    const { req, res } = makeReqRes({ [CORRELATION_ID_HEADER]: '' });
    middleware.use(req, res, () => {
      const id = correlationStorage.getStore()?.correlationId ?? '';
      const uuidPattern = /^[0-9a-f-]{36}$/i;
      uuidPattern.test(id) ? done() : done(new Error(`not a UUID: ${id}`));
    });
  });

  it('uses first element when header is an array', (done) => {
    const { req, res } = makeReqRes({ [CORRELATION_ID_HEADER]: ['arr-id', 'second'] });
    middleware.use(req, res, () => {
      correlationStorage.getStore()?.correlationId === 'arr-id'
        ? done()
        : done(new Error('expected arr-id'));
    });
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'arr-id');
  });
});
