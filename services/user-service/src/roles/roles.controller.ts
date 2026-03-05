import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';

// orgId comes from the JWT payload forwarded by Kong as x-org-id header
@Controller('api/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  findAll(@Headers('x-org-id') orgId: string) {
    return this.rolesService.findAll(orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Headers('x-org-id') orgId: string) {
    return this.rolesService.findOne(id, orgId);
  }

  @Post()
  create(@Body() dto: CreateRoleDto, @Headers('x-org-id') orgId: string) {
    return this.rolesService.create(dto, orgId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Headers('x-org-id') orgId: string,
  ) {
    return this.rolesService.update(id, dto, orgId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Headers('x-org-id') orgId: string) {
    return this.rolesService.remove(id, orgId);
  }

  // Replace all permissions on a role
  @Post(':id/permissions')
  assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @Headers('x-org-id') orgId: string,
  ) {
    return this.rolesService.assignPermissions(id, dto, orgId);
  }

  // Remove a single permission from a role
  @Delete(':id/permissions/:permissionId')
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @Headers('x-org-id') orgId: string,
  ) {
    return this.rolesService.removePermission(id, permissionId, orgId);
  }
}
