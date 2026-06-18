import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @SkipThrottle()
  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'audit-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'audit-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'audit-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'audit-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'audit-service' } } })
  @Get('ready')
  async ready() {
    const depsOk = await this.healthService.checkDependencies();
    if (!depsOk) {
      throw new ServiceUnavailableException('Dependencies not ready');
    }
    return { status: 'ok', service: 'audit-service' };
  }
}
