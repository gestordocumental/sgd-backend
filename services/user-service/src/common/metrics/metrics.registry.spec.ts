import { getHttpRequestDurationHistogram, getRegistry } from '@sgd/common';

describe('metrics registry', () => {
  it('returns the same registry instance for the process', () => {
    expect(getRegistry()).toBe(getRegistry());
  });

  it('creates and reuses the HTTP request duration histogram', async () => {
    const histogram = getHttpRequestDurationHistogram();

    expect(getHttpRequestDurationHistogram()).toBe(histogram);

    histogram.observe(
      { method: 'GET', route: '/api/users', status_code: '200' },
      0.015,
    );

    await expect(getRegistry().metrics()).resolves.toContain(
      'http_request_duration_seconds',
    );
  });
});
