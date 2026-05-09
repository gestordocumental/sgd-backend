import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let dbIndicator: jest.Mocked<TypeOrmHealthIndicator>;
  let mockRedis: { ping: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;

    dbIndicator = {
      pingCheck: jest.fn(),
    } as unknown as jest.Mocked<TypeOrmHealthIndicator>;

    mockRedis = { ping: jest.fn().mockResolvedValue('PONG') };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: dbIndicator },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('startup', () => {
    it('should return ok status', () => {
      expect(controller.startup()).toEqual({ status: 'ok', service: 'auth-service' });
    });
  });

  describe('live', () => {
    it('should return ok status', () => {
      expect(controller.live()).toEqual({ status: 'ok', service: 'auth-service' });
    });
  });

  describe('ready', () => {
    it('should call health.check with postgresql and redis indicators', async () => {
      const healthResult = {
        status: 'ok',
        info: { postgresql: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: { postgresql: { status: 'up' }, redis: { status: 'up' } },
      };
      healthCheckService.check.mockResolvedValue(healthResult as any);
      dbIndicator.pingCheck.mockResolvedValue({ postgresql: { status: 'up' } });

      const result = await controller.ready();

      expect(healthCheckService.check).toHaveBeenCalledWith([
        expect.any(Function),
        expect.any(Function),
      ]);
      expect(result).toEqual(healthResult);
    });

    it('should perform postgresql ping check', async () => {
      healthCheckService.check.mockImplementation(async (indicators) => {
        await indicators[0]();
        return { status: 'ok' } as any;
      });
      dbIndicator.pingCheck.mockResolvedValue({ postgresql: { status: 'up' } });

      await controller.ready();

      expect(dbIndicator.pingCheck).toHaveBeenCalledWith('postgresql');
    });

    it('should perform redis ping check', async () => {
      healthCheckService.check.mockImplementation(async (indicators) => {
        const result = await indicators[1]();
        return result as any;
      });

      const result = await controller.ready();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toEqual({ redis: { status: 'up' } });
    });

    it('should propagate health check errors', async () => {
      healthCheckService.check.mockRejectedValue(new Error('DB down'));

      await expect(controller.ready()).rejects.toThrow('DB down');
    });
  });
});
