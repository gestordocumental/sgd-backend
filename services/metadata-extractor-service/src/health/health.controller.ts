import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @ApiOperation({ summary: 'Startup probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('startup')
  startup() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }

  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('live')
  live() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }

  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'metadata-extractor-service' } } })
  @Get('ready')
  ready() {
    return { status: 'ok', service: 'metadata-extractor-service' };
  }
}
