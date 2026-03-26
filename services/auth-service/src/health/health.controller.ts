import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  // startupProbe: Did the process start? Yes if we get here.
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'auth-service' };
  }

  // livenessProbe: Is the process alive? (not deadlocked)
  @Get('live')
  live() {
    return { status: 'ok', service: 'auth-service' };
  }

  // readinessProbe: Can it handle traffic? Requires DB and Redis to be operational.
  @Get('ready')
  @HealthCheck()
  async ready() {
    return this.health.check([
      () => this.db.pingCheck('postgresql'),
      async (): Promise<HealthIndicatorResult> => {
        await this.redis.ping();
        return { redis: { status: 'up' } };
      },
    ]);
  }
}
