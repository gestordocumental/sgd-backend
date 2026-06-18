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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ExtractorClientService, PreviewExtractResult } from '../common/extractor-client/extractor-client.service';
import { OrgClientService } from '../common/org-client/org-client.service';
import { JwtGuard, OrgMember } from '@sgd/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTypologyDto } from './dto/create-typology.dto';
import { ResolveDiscrepancyDto } from './dto/resolve-discrepancy.dto';
import { TypologyResponseDto } from './dto/typology-response.dto';
import { UpdateTypologyDto } from './dto/update-typology.dto';
import { CreationSource } from './schemas/typology.schema';
import { TypologiesService } from './typologies.service';
import { multerOptions } from '../document-upload/document-upload.constants';

@ApiTags('Typologies')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/v1/documents/:orgId/typologies')
@UseGuards(JwtGuard)
@OrgMember()
export class TypologiesController {
  constructor(
    private readonly service: TypologiesService,
    private readonly orgClient: OrgClientService,
    private readonly extractorClient: ExtractorClientService,
  ) {}

  @ApiOperation({
    summary: 'Synchronous metadata extraction preview — internal use only',
    description: 'Accepts a PDF/DOCX file and returns extracted nombre, codigo and version without persisting anything.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file:    { type: 'string', format: 'binary' },
        orgName: { type: 'string', nullable: true, example: 'Helisa SAS' },
      },
    },
  })
  @ApiOkResponse({ schema: { example: { nombre: 'Política de Seguridad', codigo: 'POL-SEG-001', version: 'v1.0' } } })
  @Post('preview-extract')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async previewExtract(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Body('orgName') orgName?: string,
  ): Promise<PreviewExtractResult> {
    if (req.fileValidationError) throw req.fileValidationError;
    if (!file) throw new BadRequestException('El archivo es requerido');
    return this.extractorClient.previewExtract(file, orgName);
  }

  @ApiOperation({ summary: 'Storage and typology statistics for an organization' })
  @ApiOkResponse({ schema: { example: { totalTypologies: 10, activeTypologies: 7, uploadedDocuments: 5, storageTotalBytes: 10485760, extractionStatusCounts: {} } } })
  @Get('stats')
  getStats(@Param('orgId') orgId: string) {
    return this.service.getStats(orgId);
  }

  @ApiOperation({ summary: 'Create a typology for an organization' })
  @ApiCreatedResponse({ description: 'Typology created', type: TypologyResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation error or unresolved org structure',
    schema: { example: { message: 'Department not found', error: 'Bad Request', statusCode: 400 } },
  })
  @Post()
  async create(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId') orgId: string,
    @Body() dto: CreateTypologyDto,
  ): Promise<TypologyResponseDto> {
    const structure = await this.orgClient.resolveStructureById(
      orgId,
      dto.departamentoId,
      dto.areaId,
      dto.cargoId,
    );

    const created = await this.service.create(orgId, dto, {
      departamentoId:     structure.departamentoId,
      departamentoNombre: structure.departamentoNombre,
      areaId:             structure.areaId,
      areaNombre:         structure.areaNombre,
      cargoId:            structure.cargoId,
      cargoNombre:        structure.cargoNombre,
    }, CreationSource.MANUAL, actorId);

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
    const typologies = await this.service.findAll(orgId, Math.max(page, 1), Math.min(Math.max(limit, 1), 100));
    return typologies.map(TypologyResponseDto.fromDocument);
  }

  @ApiOperation({ summary: 'Get full history (including archived/deleted) for a given codigo — capped at 50 versions' })
  @ApiParam({ name: 'codigo', description: 'Typology codigo' })
  @ApiOkResponse({ description: 'Typology history (most recent first, max 50)', type: TypologyResponseDto, isArray: true })
  @Get('history/:codigo')
  async findHistory(
    @Param('orgId') orgId: string,
    @Param('codigo') codigo: string,
  ): Promise<TypologyResponseDto[]> {
    const typologies = await this.service.findHistory(orgId, codigo);
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
    @CurrentUser() actorId: string | undefined,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTypologyDto,
  ): Promise<TypologyResponseDto> {
    const hasStructureChange = dto.departamentoId !== undefined || dto.areaId !== undefined || dto.cargoId !== undefined;

    if (hasStructureChange && dto.departamentoId === undefined) {
      throw new BadRequestException('departamentoId is required when updating org structure');
    }

    const structureNames = hasStructureChange
      ? await this.orgClient.resolveStructureById(orgId, dto.departamentoId!, dto.areaId, dto.cargoId)
      : undefined;

    return TypologyResponseDto.fromDocument(await this.service.update(orgId, id, dto, structureNames, actorId));
  }

  @ApiOperation({ summary: 'Soft delete a typology' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiNoContentResponse({ description: 'Typology deleted' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.remove(orgId, id, actorId);
  }

  @ApiOperation({ summary: 'Resolve extraction discrepancies or confirm extracted metadata' })
  @ApiParam({ name: 'id', description: 'MongoDB typology id' })
  @ApiOkResponse({ description: 'Typology updated after resolution', type: TypologyResponseDto })
  @Patch(':id/resolve-extraction')
  async resolveDiscrepancy(
    @CurrentUser() actorId: string | undefined,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ResolveDiscrepancyDto,
  ): Promise<TypologyResponseDto> {
    return this.service.resolveDiscrepancy(orgId, id, dto, actorId).then(
      TypologyResponseDto.fromDocument,
    );
  }
}
