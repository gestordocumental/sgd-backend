import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard, OrgMember } from '@sgd/common';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { DocumentUploadService } from './document-upload.service';
import { TypologyResponseDto } from '../typologies/dto/typology-response.dto';
import { multerOptions } from './document-upload.constants';

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

@ApiTags('Document Upload')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@ApiParam({ name: 'id', description: 'MongoDB typology id' })
@Controller('api/v1/documents/:orgId/typologies/:id')
@UseGuards(JwtGuard)
@OrgMember()
export class DocumentUploadController {
  constructor(private readonly service: DocumentUploadService) {}

  @ApiOperation({ summary: 'Upload a PDF, DOCX or XLSX file for a typology' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file:    { type: 'string', format: 'binary' },
        orgName: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document uploaded', type: DocumentUploadResponseDto })
  @ApiBadRequestResponse({ description: 'Missing file or invalid mimetype' })
  @Post('file')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async upload(
    @Headers('authorization') auth: string,
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('orgName') orgName?: string,
  ): Promise<DocumentUploadResponseDto> {
    if (!file) throw new BadRequestException('El archivo es requerido');
    return this.service.upload(orgId, typologyId, file, orgName, extractUserId(auth));
  }

  @ApiOperation({ summary: 'Re-queue metadata extraction when previous attempt failed' })
  @ApiOkResponse({ description: 'Extraction re-queued', schema: { example: { message: 'Extracción reencolada.', extractionStatus: 'PROCESSING' } } })
  @ApiBadRequestResponse({ description: 'No document loaded or extraction not in FAILED state' })
  @Post('retry-extraction')
  retryExtraction(
    @Headers('authorization') auth: string,
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
    @Body('orgName') orgName?: string,
  ): Promise<{ message: string; extractionStatus: string }> {
    return this.service.retryExtraction(orgId, typologyId, orgName, extractUserId(auth));
  }

  @ApiOperation({ summary: 'Get a temporary signed download URL for the uploaded file' })
  @ApiOkResponse({ description: 'Signed URL generated', type: SignedUrlResponseDto })
  @Get('signed-url')
  getSignedUrl(
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
  ): Promise<SignedUrlResponseDto> {
    return this.service.getSignedUrl(orgId, typologyId);
  }

  @ApiOperation({
    summary: 'Archive this typology and create a new version with an updated document',
    description: 'Archives the current typology (status → ARCHIVED) and creates a new one with the same codigo. The new version must be strictly greater than the current one.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file:    { type: 'string', format: 'binary', description: 'New document file' },
        nombre:  { type: 'string', description: 'New name (optional, defaults to current)' },
        version: { type: 'string', description: 'New version — must be greater than current' },
        orgName: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'New version created', type: TypologyResponseDto })
  @Post('new-version')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async createNewVersion(
    @Headers('authorization') auth: string,
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('nombre')  nombre?: string,
    @Body('version') version?: string,
    @Body('orgName') orgName?: string,
  ): Promise<TypologyResponseDto> {
    if (!file) throw new BadRequestException('El archivo es requerido');
    return this.service.createNewVersion(orgId, typologyId, file, { nombre, version, orgName, actorId: extractUserId(auth) });
  }
}
