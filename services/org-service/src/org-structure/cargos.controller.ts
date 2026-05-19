import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
  InternalServerErrorException,
} from '@nestjs/common';

function requireActor(actorId: string | undefined): string {
  if (!actorId) throw new InternalServerErrorException('Could not resolve caller identity');
  return actorId;
}
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CargosService } from './cargos.service';
import { CreateCargoDto } from './dto/create-cargo.dto';
import { UpdateCargoDto } from './dto/update-cargo.dto';
import { CargoResponseDto } from './dto/cargo-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Org Structure — Cargos')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@ApiParam({ name: 'departamentoId', format: 'uuid' })
@ApiParam({ name: 'areaId', format: 'uuid' })
@Controller('api/org/:orgId/departamentos/:departamentoId/areas/:areaId/cargos')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class CargosController {
  constructor(private readonly service: CargosService) {}

  @ApiOperation({ summary: 'Create a position within an area' })
  @ApiResponse({ status: 201, type: CargoResponseDto })
  @Post()
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async create(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: CreateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.create(orgId, departamentoId, areaId, dto, requireActor(actorId)));
  }

  @ApiOperation({ summary: 'List all positions within an area' })
  @ApiResponse({ status: 200, type: CargoResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ): Promise<CargoResponseDto[]> {
    return (await this.service.findAll(orgId, departamentoId, areaId)).map(CargoResponseDto.from);
  }

  @ApiOperation({ summary: 'Get position by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Get(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.findOne(orgId, departamentoId, areaId, id));
  }

  @ApiOperation({ summary: 'Update position' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Patch(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async update(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.update(orgId, departamentoId, areaId, id, dto, requireActor(actorId)));
  }

  @ApiOperation({ summary: 'Soft delete position' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgPermission('ORG_STRUCTURE', 'DELETE')
  async remove(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, departamentoId, areaId, id, requireActor(actorId));
  }

  @ApiOperation({ summary: 'Restore a deleted position' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.restore(orgId, departamentoId, areaId, id, requireActor(actorId)));
  }
}
