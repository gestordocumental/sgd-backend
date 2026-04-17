import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
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
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.create(orgId, dto));
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
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.update(orgId, id, dto));
  }

  @ApiOperation({ summary: 'Soft delete department' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgPermission('ORG_STRUCTURE', 'DELETE')
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, id);
  }

  @ApiOperation({ summary: 'Restore a deleted department' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: DepartamentoResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.restore(orgId, id));
  }
}
