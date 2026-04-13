import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'auth-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'auth-service' };
  }

  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'auth-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'auth-service' };
  }

  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: {
          postgresql: { status: 'up' },
          redis: { status: 'up' },
        },
        error: {},
        details: {
          postgresql: { status: 'up' },
          redis: { status: 'up' },
        },
      },
    },
  })
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
