import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Headers, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { DepartamentosService } from './departamentos.service';
import { CreateDepartamentoDto } from './dto/create-departamento.dto';
import { UpdateDepartamentoDto } from './dto/update-departamento.dto';
import { DepartamentoResponseDto } from './dto/departamento-response.dto';
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

@ApiTags('Org Structure — Departamentos')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/org/:orgId/departamentos')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class DepartamentosController {
  constructor(private readonly service: DepartamentosService) {}

  @ApiOperation({ summary: 'Create a department' })
  @ApiResponse({ status: 201, type: DepartamentoResponseDto })
  @Post()
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async create(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.create(orgId, dto, extractUserId(auth)));
  }

  @ApiOperation({ summary: 'List all departments of an organization' })
  @ApiResponse({ status: 200, type: DepartamentoResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<DepartamentoResponseDto[]> {
    return (await this.service.findAll(orgId)).map(DepartamentoResponseDto.from);
  }

  @ApiOperation({ summary: 'Get department by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: DepartamentoResponseDto })
  @Get(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.findOne(orgId, id));
  }

  @ApiOperation({ summary: 'Update department' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: DepartamentoResponseDto })
  @Patch(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async update(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.update(orgId, id, dto, extractUserId(auth)));
  }

  @ApiOperation({ summary: 'Soft delete department' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgPermission('ORG_STRUCTURE', 'DELETE')
  async remove(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, id, extractUserId(auth));
  }

  @ApiOperation({ summary: 'Restore a deleted department' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: DepartamentoResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @Headers('authorization') auth: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.restore(orgId, id, extractUserId(auth)));
  }
}
