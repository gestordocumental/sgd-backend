import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { AreasService } from './areas.service';
import { AreaResponseDto } from './dto/area-response.dto';

@ApiTags('Org Structure - Areas')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/v1/org/:orgId/areas')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class OrgAreasController {
  constructor(private readonly service: AreasService) {}

  @ApiOperation({ summary: 'List all areas in an organization (flat)' })
  @ApiOkResponse({ description: 'Areas found', type: AreaResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<AreaResponseDto[]> {
    return (await this.service.findAllByOrg(orgId)).map(AreaResponseDto.from);
  }
}
