import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { CargosService } from './cargos.service';
import { CreateCargoDto } from './dto/create-cargo.dto';
import { UpdateCargoDto } from './dto/update-cargo.dto';
import { CargoResponseDto } from './dto/cargo-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';

@Controller('api/org/:orgId/departamentos/:departamentoId/areas/:areaId/cargos')
@UseGuards(OrgGuard)
@OrgMemberOrSuperAdmin()
export class CargosController {
  constructor(private readonly service: CargosService) {}

  @Post()
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: CreateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.create(orgId, departamentoId, areaId, dto));
  }

  @Get()
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ): Promise<CargoResponseDto[]> {
    return (await this.service.findAll(orgId, departamentoId, areaId)).map(CargoResponseDto.from);
  }

  @Get(':id')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.findOne(orgId, departamentoId, areaId, id));
  }

  @Patch(':id')
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCargoDto,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.update(orgId, departamentoId, areaId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, departamentoId, areaId, id);
  }

  @Post(':id/restore')
  async restore(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CargoResponseDto> {
    return CargoResponseDto.from(await this.service.restore(orgId, departamentoId, areaId, id));
  }
}
