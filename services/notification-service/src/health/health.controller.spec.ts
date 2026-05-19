import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

function makeHealthService(): jest.Mocked<HealthCheckService> {
  return { check: jest.fn() } as any;
}

function makeDbIndicator(): jest.Mocked<TypeOrmHealthIndicator> {
  return { pingCheck: jest.fn() } as any;
}

describe('HealthController', () => {
  let ctrl: HealthController;
  let health: jest.Mocked<HealthCheckService>;
  let db: jest.Mocked<TypeOrmHealthIndicator>;

  beforeEach(() => {
    health = makeHealthService();
    db     = makeDbIndicator();
    ctrl   = new HealthController(health, db);
  });

  it('startup() returns ok', () => {
    expect(ctrl.startup()).toEqual({ status: 'ok', service: 'notification-service' });
  });

  it('live() returns ok', () => {
    expect(ctrl.live()).toEqual({ status: 'ok', service: 'notification-service' });
  });

  it('ready() calls health.check with db.pingCheck', async () => {
    const healthResult = { status: 'ok', info: { postgresql: { status: 'up' } } };
    health.check.mockResolvedValue(healthResult as any);
    db.pingCheck.mockResolvedValue({ postgresql: { status: 'up' } } as any);
    await ctrl.ready();
    expect(health.check).toHaveBeenCalledWith([expect.any(Function)]);
    const checkFn = health.check.mock.calls[0][0][0];
    await checkFn();
    expect(db.pingCheck).toHaveBeenCalledWith('postgresql');
  });
});
