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
import { CargosService } from './cargos.service';
import { CargoResponseDto } from './dto/cargo-response.dto';

@ApiTags('Org Structure - Cargos')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/org/:orgId/cargos')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class OrgCargosController {
  constructor(private readonly service: CargosService) {}

  @ApiOperation({ summary: 'List all positions in an organization' })
  @ApiOkResponse({ description: 'Positions found', type: CargoResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<CargoResponseDto[]> {
    return (await this.service.findAllByOrg(orgId)).map(CargoResponseDto.from);
  }
}
