import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { AreasService } from './areas.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { AreaResponseDto } from './dto/area-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';

@Controller('api/org/:orgId/departamentos/:departamentoId/areas')
@UseGuards(OrgGuard)
@OrgMemberOrSuperAdmin()
export class AreasController {
  constructor(private readonly service: AreasService) {}

  @Post()
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Body() dto: CreateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.create(orgId, departamentoId, dto));
  }

  @Get()
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
  ): Promise<AreaResponseDto[]> {
    return (await this.service.findAll(orgId, departamentoId)).map(AreaResponseDto.from);
  }

  @Get(':id')
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.findOne(orgId, departamentoId, id));
  }

  @Patch(':id')
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.update(orgId, departamentoId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(orgId, departamentoId, id);
  }

  @Post(':id/restore')
  async restore(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('departamentoId', ParseUUIDPipe) departamentoId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AreaResponseDto> {
    return AreaResponseDto.from(await this.service.restore(orgId, departamentoId, id));
  }
}
