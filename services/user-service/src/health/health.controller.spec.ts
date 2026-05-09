import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let dbIndicator: jest.Mocked<TypeOrmHealthIndicator>;

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn(),
    } as any;

    dbIndicator = {
      pingCheck: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: healthCheckService,
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: dbIndicator,
        },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  // ─── startup ──────────────────────────────────────────────────────────────

  describe('startup()', () => {
    it('returns { status: "ok", service: "user-service" }', () => {
      expect(controller.startup()).toEqual({ status: 'ok', service: 'user-service' });
    });
  });

  // ─── live ─────────────────────────────────────────────────────────────────

  describe('live()', () => {
    it('returns { status: "ok", service: "user-service" }', () => {
      expect(controller.live()).toEqual({ status: 'ok', service: 'user-service' });
    });
  });

  // ─── ready ────────────────────────────────────────────────────────────────

  describe('ready()', () => {
    it('calls health.check and returns the result', async () => {
      const healthResult = {
        status: 'ok',
        info: { postgresql: { status: 'up' } },
        error: {},
        details: { postgresql: { status: 'up' } },
      };
      healthCheckService.check.mockResolvedValue(healthResult as any);

      const result = await controller.ready();

      expect(healthCheckService.check).toHaveBeenCalledTimes(1);
      expect(result).toEqual(healthResult);
    });

    it('passes a ping-check function for postgresql to health.check', async () => {
      healthCheckService.check.mockImplementation(async (indicators) => {
        // Execute the passed indicator to verify it calls db.pingCheck('postgresql')
        for (const indicator of indicators) {
          await indicator();
        }
        return { status: 'ok' } as any;
      });
      dbIndicator.pingCheck.mockResolvedValue({ postgresql: { status: 'up' } } as any);

      await controller.ready();

      expect(dbIndicator.pingCheck).toHaveBeenCalledWith('postgresql');
    });

    it('propagates HealthCheckError when the database is down', async () => {
      const dbError = new Error('Connection refused');
      healthCheckService.check.mockRejectedValue(dbError);

      await expect(controller.ready()).rejects.toThrow('Connection refused');
    });
  });
});
