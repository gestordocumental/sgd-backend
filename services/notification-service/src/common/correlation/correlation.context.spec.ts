import { correlationStorage, getCorrelationId } from './correlation.context';

describe('correlation.context', () => {
  it('returns no-correlation-id outside of a run context', () => {
    expect(getCorrelationId()).toBe('no-correlation-id');
  });

  it('returns the stored correlationId inside a run context', (done) => {
    correlationStorage.run({ correlationId: 'test-id' }, () => {
      expect(getCorrelationId()).toBe('test-id');
      done();
    });
  });
});
