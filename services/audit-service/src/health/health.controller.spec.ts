import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller:    HealthController;
  let healthService: jest.Mocked<Pick<HealthService, 'checkDependencies'>>;

  beforeEach(() => {
    healthService = { checkDependencies: jest.fn() };
    controller    = new HealthController(healthService as unknown as HealthService);
  });

  it('startup returns ok', () => {
    expect(controller.startup()).toEqual({ status: 'ok', service: 'audit-service' });
  });

  it('live returns ok', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'audit-service' });
  });

  it('ready returns ok when dependencies are healthy', async () => {
    healthService.checkDependencies.mockResolvedValue(true);
    const result = await controller.ready();
    expect(result).toEqual({ status: 'ok', service: 'audit-service' });
  });

  it('ready throws ServiceUnavailableException when dependencies are down', async () => {
    healthService.checkDependencies.mockResolvedValue(false);
    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
  });
});
