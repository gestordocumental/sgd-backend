import { Controller, Get, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { CargosService } from './cargos.service';
import { CargoResponseDto } from './dto/cargo-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';

@Controller('api/org/:orgId/cargos')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class OrgCargosController {
  constructor(private readonly service: CargosService) {}

  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<CargoResponseDto[]> {
    return (await this.service.findAllByOrg(orgId)).map(CargoResponseDto.from);
  }
}
