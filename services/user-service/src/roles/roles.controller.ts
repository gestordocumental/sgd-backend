import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { OrgId } from '../common/decorators/org-id.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

// orgId comes from the JWT payload forwarded by Kong as x-org-id header
@ApiTags('Roles')
@ApiBearerAuth('JWT')
@Controller('api/v1/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: 'List all roles for the current organization' })
  @Get()
  findAll(@OrgId() orgId: string) {
    return this.rolesService.findAll(orgId);
  }

  @ApiOperation({ summary: 'Get role by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Get(':id')
  findOne(@Param('id') id: string, @OrgId() orgId: string) {
    return this.rolesService.findOne(id, orgId);
  }

  @ApiOperation({ summary: 'Create a custom role for the organization' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @Post()
  create(@Body() dto: CreateRoleDto, @OrgId() orgId: string) {
    return this.rolesService.create(dto, orgId);
  }

  @ApiOperation({ summary: 'Update role name or description' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.update(id, dto, orgId);
  }

  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Delete(':id')
  remove(@Param('id') id: string, @OrgId() orgId: string) {
    return this.rolesService.remove(id, orgId);
  }

  @ApiOperation({ summary: 'Replace all permissions on a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  // Replace all permissions on a role
  @Post(':id/permissions')
  assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.assignPermissions(id, dto, orgId);
  }

  @ApiOperation({ summary: 'Remove a single permission from a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'permissionId', format: 'uuid' })
  // Remove a single permission from a role
  @Delete(':id/permissions/:permissionId')
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.removePermission(id, permissionId, orgId);
  }
}
