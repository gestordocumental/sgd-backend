import { getHttpRequestDurationHistogram, getRegistry } from './metrics.registry';

describe('metrics registry', () => {
  it('returns the same process registry instance', () => {
    expect(getRegistry()).toBe(getRegistry());
  });

  it('creates and reuses the HTTP request duration histogram', async () => {
    const histogram = getHttpRequestDurationHistogram();

    expect(getHttpRequestDurationHistogram()).toBe(histogram);

    histogram.observe(
      { method: 'GET', route: '/health', status_code: '200' },
      0.025,
    );

    await expect(getRegistry().metrics()).resolves.toContain(
      'http_request_duration_seconds',
    );
  });
});
