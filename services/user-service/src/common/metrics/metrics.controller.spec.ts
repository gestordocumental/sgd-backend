import { MetricsController, getRegistry } from '@sgd/common';

jest.mock('@sgd/common/metrics/metrics.registry', () => ({
  getRegistry: jest.fn(),
}));

describe('MetricsController', () => {
  it('returns metrics from the Prometheus registry', async () => {
    const metrics = '# HELP test_metric Test metric\n# TYPE test_metric counter\n';
    const registry = { metrics: jest.fn().mockResolvedValue(metrics) };
    (getRegistry as jest.Mock).mockReturnValue(registry);

    const controller = new MetricsController();

    await expect(controller.getMetrics()).resolves.toBe(metrics);
    expect(getRegistry).toHaveBeenCalledTimes(1);
    expect(registry.metrics).toHaveBeenCalledTimes(1);
  });
});
