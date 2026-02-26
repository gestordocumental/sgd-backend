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

  // startupProbe: ¿arrancó el proceso? Sí si llegamos aquí.
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'auth-service' };
  }

  // livenessProbe: ¿está vivo el proceso? (no deadlocked)
  @Get('live')
  live() {
    return { status: 'ok', service: 'auth-service' };
  }

  // readinessProbe: ¿puede atender tráfico? Requiere DB y Redis operativos.
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
