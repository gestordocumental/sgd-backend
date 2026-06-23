import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

function makeHealthService(): jest.Mocked<HealthCheckService> {
  return {
    check: jest.fn().mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} }),
  } as unknown as jest.Mocked<HealthCheckService>;
}

function makeDbIndicator(): jest.Mocked<TypeOrmHealthIndicator> {
  return {
    pingCheck: jest.fn().mockResolvedValue({ postgresql: { status: 'up' } }),
  } as unknown as jest.Mocked<TypeOrmHealthIndicator>;
}

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: jest.Mocked<HealthCheckService>;
  let dbIndicator: jest.Mocked<TypeOrmHealthIndicator>;

  beforeEach(() => {
    healthService = makeHealthService();
    dbIndicator = makeDbIndicator();
    controller = new HealthController(healthService, dbIndicator);
  });

  describe('startup()', () => {
    it('returns status ok and service name', () => {
      const result = controller.startup();
      expect(result).toEqual({ status: 'ok', service: 'workflow-service' });
    });
  });

  describe('live()', () => {
    it('returns status ok and service name', () => {
      const result = controller.live();
      expect(result).toEqual({ status: 'ok', service: 'workflow-service' });
    });
  });

  describe('ready()', () => {
    it('delegates to health.check with a db ping check', async () => {
      await controller.ready();
      expect(healthService.check).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function)]),
      );
    });

    it('uses TypeOrmHealthIndicator.pingCheck with "postgresql"', async () => {
      await controller.ready();
      // Invoke the check function that was passed to health.check
      const checkFns = (healthService.check as jest.Mock).mock.calls[0][0] as (() => Promise<unknown>)[];
      await checkFns[0]();
      expect(dbIndicator.pingCheck).toHaveBeenCalledWith('postgresql');
    });
  });
});
