import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
  ) {}

  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'document-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'document-service' };
  }

  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'document-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'document-service' };
  }

  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: { mongodb: { status: 'up' } },
        error: {},
        details: { mongodb: { status: 'up' } },
      },
    },
  })
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.mongoose.pingCheck('mongodb')]);
  }
}
