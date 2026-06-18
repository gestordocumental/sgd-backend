import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @SkipThrottle()
  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }

  @SkipThrottle()
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('ready')
  ready() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }
}
