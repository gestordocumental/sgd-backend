import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalGuard, AllowInternalTokens } from '@sgd/common';
import { OrgsService } from './orgs.service';

@ApiTags('Internal Orgs')
@ApiSecurity('internal-token')
@Controller('internal')
@UseGuards(InternalGuard)
@AllowInternalTokens('INTERNAL_TOKEN_AUTH_ORG')
export class InternalOrgsController {
  constructor(private readonly service: OrgsService) {}

  @ApiOperation({
    summary: 'Get an organization\'s status by ID — used by auth-service to reject switching into a non-active company',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { example: { id: 'uuid', status: 'active' } } })
  @Get('orgs/:id/status')
  async getStatus(@Param('id') id: string): Promise<{ id: string; status: string }> {
    const org = await this.service.findOne(id);
    return { id: org.id, status: org.status };
  }
}
