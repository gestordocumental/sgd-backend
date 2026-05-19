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

/**
 * Manages cargos that belong directly to a departamento (no area).
 * Example use case: "Director de Desarrollo" applies to the whole department,
 * not to any specific area within it.
 */
@ApiTags('Org Structure — Cargos')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@ApiParam({ name: 'departamentoId', format: 'uuid' })
@Controller('api/org/:orgId/departamentos/:departamentoId/cargos')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class DeptCargosController {
  constructor(private readonly service: CargosService) {}

  @ApiOperation({ summary: 'Create a department-level position (no area)' })
  @ApiResponse({ status: 201, type: CargoResponseDto })
  @Post()
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async create(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Body() dto: CreateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(
      await this.service.create(orgId, departamentoId, null, dto, requireActor(actorId)),
    );
  }

  @ApiOperation({ summary: 'List department-level positions (no area)' })
  @ApiResponse({ status: 200, type: CargoResponseDto, isArray: true })
  @Get()
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
  ): Promise<CargoResponseDto[]> {
    return (await this.service.findByDepartamento(orgId, departamentoId)).map(CargoResponseDto.from);
  }

  @ApiOperation({ summary: 'Get a department-level position by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Get(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'READ')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.findOneDept(orgId, departamentoId, id));
  }

  @ApiOperation({ summary: 'Update a department-level position' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Patch(':id')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async update(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(
      await this.service.updateDept(orgId, departamentoId, id, dto, requireActor(actorId)),
    );
  }

  @ApiOperation({ summary: 'Soft delete a department-level position' })
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
    return this.service.removeDept(orgId, departamentoId, id, requireActor(actorId));
  }

  @ApiOperation({ summary: 'Restore a deleted department-level position' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: CargoResponseDto })
  @Post(':id/restore')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  async restore(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(
      await this.service.restoreDept(orgId, departamentoId, id, requireActor(actorId)),
    );
  }
}
