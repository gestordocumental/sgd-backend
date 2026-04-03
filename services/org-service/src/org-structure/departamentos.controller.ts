import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { DepartamentosService } from './departamentos.service';
import { CreateDepartamentoDto } from './dto/create-departamento.dto';
import { UpdateDepartamentoDto } from './dto/update-departamento.dto';
import { DepartamentoResponseDto } from './dto/departamento-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';

@Controller('api/org/:orgId/departamentos')
@UseGuards(OrgGuard)
@OrgMemberOrSuperAdmin()
export class DepartamentosController {
  constructor(private readonly service: DepartamentosService) {}

  @Post()
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.create(orgId, dto));
  }

  @Get()
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<DepartamentoResponseDto[]> {
    return (await this.service.findAll(orgId)).map(DepartamentoResponseDto.from);
  }

  @Get(':id')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.findOne(orgId, id));
  }

  @Patch(':id')
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartamentoDto,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.update(orgId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, id);
  }

  @Post(':id/restore')
  async restore(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartamentoResponseDto> {
    return DepartamentoResponseDto.from(await this.service.restore(orgId, id));
  }
}
