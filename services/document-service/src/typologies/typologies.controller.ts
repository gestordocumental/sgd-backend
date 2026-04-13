import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgClientService } from '../common/org-client/org-client.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { OrgMember } from '../common/decorators/auth.decorator';
import { CreateTypologyDto } from './dto/create-typology.dto';
import { ResolveDiscrepancyDto } from './dto/resolve-discrepancy.dto';
import { TypologyResponseDto } from './dto/typology-response.dto';
import { UpdateTypologyDto } from './dto/update-typology.dto';
import { CreationSource } from './schemas/typology.schema';
import { TypologiesService } from './typologies.service';

@ApiTags('Typologies')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/documents/:orgId/typologies')
@UseGuards(JwtGuard)
@OrgMember()
export class TypologiesController {
  constructor(
    private readonly service: TypologiesService,
    private readonly orgClient: OrgClientService,
  ) {}

  @ApiOperation({ summary: 'Create a typology for an organization' })
  @ApiCreatedResponse({ description: 'Typology created', type: TypologyResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation error or unresolved org structure',
    schema: { example: { message: 'Department not found', error: 'Bad Request', statusCode: 400 } },
  })
  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateTypologyDto,
  ): Promise<TypologyResponseDto> {
    const resolved = await this.orgClient.resolveStructure(orgId, [{
      department: dto.departamentoId,
      area: dto.areaId,
      position: dto.cargoId,
    }]);

    if (resolved.unresolved.length > 0) {
      throw new BadRequestException(resolved.unresolved[0].reason);
    }

    const r = resolved.resolved[0];
    const created = await this.service.create(orgId, dto, {
      departamentoId: r.departamentoId,
      departamentoNombre: dto.departamentoId,
      areaId: r.areaId,
      cargoId: r.cargoId,
    }, CreationSource.MANUAL);

    return TypologyResponseDto.fromDocument(created);
  }

  @ApiOperation({ summary: 'List typologies for an organization' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: 'Typologies found', type: TypologyResponseDto, isArray: true })
  @Get()
  async findAll(
    @Param('orgId') orgId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<TypologyResponseDto[]> {
    const typologies = await this.service.findAll(orgId, page, Math.min(limit, 100));
    return typologies.map(TypologyResponseDto.fromDocument);
  }

  @ApiOperation({ summary: 'Get a typology by ID' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiOkResponse({ description: 'Typology found', type: TypologyResponseDto })
  @Get(':id')
  async findOne(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<TypologyResponseDto> {
    return TypologyResponseDto.fromDocument(await this.service.findOne(orgId, id));
  }

  @ApiOperation({ summary: 'Update a typology' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiOkResponse({ description: 'Typology updated', type: TypologyResponseDto })
  @Patch(':id')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTypologyDto,
  ): Promise<TypologyResponseDto> {
    return TypologyResponseDto.fromDocument(await this.service.update(orgId, id, dto));
  }

  @ApiOperation({ summary: 'Soft delete a typology' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiNoContentResponse({ description: 'Typology deleted' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.remove(orgId, id);
  }

  @ApiOperation({ summary: 'Resolve extraction discrepancies or confirm extracted metadata' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiOkResponse({ description: 'Typology updated after resolution', type: TypologyResponseDto })
  @Patch(':id/resolve-extraction')
  async resolveDiscrepancy(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ResolveDiscrepancyDto,
  ): Promise<TypologyResponseDto> {
    return this.service.resolveDiscrepancy(orgId, id, dto).then(
      TypologyResponseDto.fromDocument,
    );
  }
}
