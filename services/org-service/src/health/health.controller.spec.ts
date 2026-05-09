import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let dbIndicator: { pingCheck: jest.Mock };

  beforeEach(async () => {
    healthCheckService = { check: jest.fn() };
    dbIndicator = { pingCheck: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: dbIndicator },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('startup()', () => {
    it('returns status ok with service name', () => {
      const result = controller.startup();

      expect(result).toEqual({ status: 'ok', service: 'org-service' });
    });

    it('does not call the health check service', () => {
      controller.startup();

      expect(healthCheckService.check).not.toHaveBeenCalled();
    });
  });

  describe('live()', () => {
    it('returns status ok with service name', () => {
      const result = controller.live();

      expect(result).toEqual({ status: 'ok', service: 'org-service' });
    });

    it('does not call the health check service', () => {
      controller.live();

      expect(healthCheckService.check).not.toHaveBeenCalled();
    });
  });

  describe('ready()', () => {
    it('calls health.check and delegates the result', async () => {
      const healthResult = {
        status: 'ok',
        info: { postgresql: { status: 'up' } },
        error: {},
        details: { postgresql: { status: 'up' } },
      };
      healthCheckService.check.mockResolvedValue(healthResult);
      dbIndicator.pingCheck.mockResolvedValue({ postgresql: { status: 'up' } });

      // Simulate what HealthCheckService.check does: call the indicator factory
      healthCheckService.check.mockImplementation(async (indicators: (() => any)[]) => {
        for (const indicator of indicators) {
          await indicator();
        }
        return healthResult;
      });

      const result = await controller.ready();

      expect(healthCheckService.check).toHaveBeenCalledWith([expect.any(Function)]);
      expect(dbIndicator.pingCheck).toHaveBeenCalledWith('postgresql');
      expect(result).toEqual(healthResult);
    });

    it('propagates errors from the health check service', async () => {
      const error = new Error('Database unreachable');
      healthCheckService.check.mockRejectedValue(error);

      await expect(controller.ready()).rejects.toThrow('Database unreachable');
    });

    it('propagates errors from the TypeORM ping check', async () => {
      const pingError = new Error('Connection refused');
      dbIndicator.pingCheck.mockRejectedValue(pingError);
      healthCheckService.check.mockImplementation(async (indicators: (() => any)[]) => {
        for (const indicator of indicators) {
          await indicator();
        }
      });

      await expect(controller.ready()).rejects.toThrow('Connection refused');
    });
  });
});
