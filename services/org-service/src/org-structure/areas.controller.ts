import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Headers, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AreasService } from './areas.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { AreaResponseDto } from './dto/area-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';

function extractUserId(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(authHeader.split(' ')[1].split('.')[1], 'base64url').toString('utf8'),
    );
    return (payload.sub as string) ?? undefined;
  } catch {
    return undefined;
  }
}

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
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Body() dto: CreateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.create(orgId, departamentoId, dto, extractUserId(auth)));
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
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.update(orgId, departamentoId, id, dto, extractUserId(auth)));
  }

  @ApiOperation({ summary: 'Soft delete area' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgPermission('ORG_STRUCTURE', 'DELETE')
  async remove(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, departamentoId, id, extractUserId(auth));
  }

  @ApiOperation({ summary: 'Restore a deleted area' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AreaResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.restore(orgId, departamentoId, id, extractUserId(auth)));
  }
}
