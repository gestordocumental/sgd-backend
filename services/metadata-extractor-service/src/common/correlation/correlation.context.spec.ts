import { correlationStorage, getCorrelationId } from '@sgd/common';

describe('correlation context', () => {
  it('returns the fallback id outside a correlation scope', () => {
    expect(getCorrelationId()).toBe('no-correlation-id');
  });

  it('returns the id stored in the current async scope', () => {
    correlationStorage.run({ correlationId: 'corr-123' }, () => {
      expect(getCorrelationId()).toBe('corr-123');
    });
  });
});
