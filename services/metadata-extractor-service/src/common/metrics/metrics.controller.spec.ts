import { MetricsController } from './metrics.controller';
import { getRegistry } from './metrics.registry';

jest.mock('./metrics.registry', () => ({
  getRegistry: jest.fn(),
}));

describe('MetricsController', () => {
  it('returns Prometheus metrics from the registry', async () => {
    const metrics = '# HELP test_metric Test metric\n# TYPE test_metric counter\n';
    const registry = { metrics: jest.fn().mockResolvedValue(metrics) };
    (getRegistry as jest.Mock).mockReturnValue(registry);

    const controller = new MetricsController();

    await expect(controller.getMetrics()).resolves.toBe(metrics);
    expect(getRegistry).toHaveBeenCalledTimes(1);
    expect(registry.metrics).toHaveBeenCalledTimes(1);
  });
});
