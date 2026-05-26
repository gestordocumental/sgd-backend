import { correlationStorage, getClientIp, getCorrelationId } from '@sgd/common';

describe('correlation.context', () => {
  it('getCorrelationId returns no-correlation-id outside of a run context', () => {
    expect(getCorrelationId()).toBe('no-correlation-id');
  });

  it('getCorrelationId returns the stored correlationId inside a run context', (done) => {
    correlationStorage.run({ correlationId: 'test-id', clientIp: null }, () => {
      expect(getCorrelationId()).toBe('test-id');
      done();
    });
  });

  it('getClientIp returns null outside of a run context', () => {
    expect(getClientIp()).toBeNull();
  });

  it('getClientIp returns the stored clientIp inside a run context', (done) => {
    correlationStorage.run({ correlationId: 'test-id', clientIp: '192.168.1.1' }, () => {
      expect(getClientIp()).toBe('192.168.1.1');
      done();
    });
  });
});
