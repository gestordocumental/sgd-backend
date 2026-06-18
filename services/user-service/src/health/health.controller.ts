import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @SkipThrottle()
  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'user-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'user-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'user-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'user-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: { postgresql: { status: 'up' } },
        error: {},
        details: { postgresql: { status: 'up' } },
      },
    },
  })
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('postgresql'),
    ]);
  }
}
