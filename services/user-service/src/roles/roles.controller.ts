import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { OrgId } from '../common/decorators/org-id.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from './entities/permission.entity';

// orgId comes from the JWT payload forwarded by Kong as x-org-id header
@ApiTags('Roles')
@ApiBearerAuth('JWT')
@Controller('api/v1/roles')
@UseGuards(PermissionsGuard)
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
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @OrgId() orgId: string) {
    return this.rolesService.findOne(id, orgId);
  }

  @ApiOperation({ summary: 'Create a custom role for the organization' })
  @ApiBody({ type: CreateRoleDto })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 409, description: 'Role name already exists in this organization' })
  @RequirePermission(PermissionModule.ORGS, PermissionAction.WRITE)
  @Post()
  create(@Body() dto: CreateRoleDto, @OrgId() orgId: string) {
    return this.rolesService.create(dto, orgId);
  }

  @ApiOperation({ summary: 'Update role name or description' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @RequirePermission(PermissionModule.ORGS, PermissionAction.WRITE)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRoleDto,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.update(id, dto, orgId);
  }

  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermission(PermissionModule.ORGS, PermissionAction.WRITE)
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @OrgId() orgId: string) {
    return this.rolesService.remove(id, orgId);
  }

  @ApiOperation({ summary: 'Replace all permissions on a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AssignPermissionsDto })
  @ApiResponse({ status: 201, description: 'Permissions replaced' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid permission IDs' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @RequirePermission(PermissionModule.ORGS, PermissionAction.WRITE)
  @Post(':id/permissions')
  assignPermissions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AssignPermissionsDto,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.assignPermissions(id, dto, orgId);
  }

  @ApiOperation({ summary: 'Remove a single permission from a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'permissionId', format: 'uuid' })
  @RequirePermission(PermissionModule.ORGS, PermissionAction.WRITE)
  @Delete(':id/permissions/:permissionId')
  removePermission(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('permissionId', new ParseUUIDPipe({ version: '4' })) permissionId: string,
    @OrgId() orgId: string,
  ) {
    return this.rolesService.removePermission(id, permissionId, orgId);
  }
}
