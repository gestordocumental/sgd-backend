import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
  UnauthorizedException,
} from '@nestjs/common';

function requireActor(actorId: string | undefined): string {
  if (!actorId) throw new UnauthorizedException('Missing authenticated user');
  return actorId;
}
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AreasService } from './areas.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { AreaResponseDto } from './dto/area-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Org Structure — Areas')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@ApiParam({ name: 'departamentoId', format: 'uuid' })
@Controller('api/org/:orgId/departamentos/:departamentoId/areas')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class AreasController {
  constructor(private readonly service: AreasService) {}

  @ApiOperation({ summary: 'Create an area within a department' })
  @ApiResponse({ status: 201, type: AreaResponseDto })
  @Post()
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async create(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Body() dto: CreateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.create(orgId, departamentoId, dto, requireActor(actorId)));
  }

  @ApiOperation({ summary: 'List all areas of a department' })
  @ApiResponse({ status: 200, type: AreaResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
  ): Promise<AreaResponseDto[]> {
    return (await this.service.findAll(orgId, departamentoId)).map(AreaResponseDto.from);
  }

  @ApiOperation({ summary: 'Get area by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AreaResponseDto })
  @Get(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.findOne(orgId, departamentoId, id));
  }

  @ApiOperation({ summary: 'Update area' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AreaResponseDto })
  @Patch(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async update(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.update(orgId, departamentoId, id, dto, requireActor(actorId)));
  }

  @ApiOperation({ summary: 'Soft delete area' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgPermission('ORG_STRUCTURE', 'DELETE')
  async remove(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, departamentoId, id, requireActor(actorId));
  }

  @ApiOperation({ summary: 'Restore a deleted area' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AreaResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.restore(orgId, departamentoId, id, requireActor(actorId)));
  }
}
