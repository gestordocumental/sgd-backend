import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtGuard, OrgMember } from '@sgd/common';
import { MAX_FILE_SIZE } from '../document-upload/document-upload.constants';
import { WorkflowFilesService } from './workflow-files.service';
import { WorkflowFileUploadResponseDto } from './dto/workflow-file-upload-response.dto';
import { DownloadZipDto } from './dto/download-zip.dto';

const WORKFLOW_MIME_WHITELIST = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
]);

const workflowMulterOptions = {
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (
    _req: any,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    // Re-interpret Latin-1 decoded bytes as UTF-8 to recover accented characters in filenames.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

    if (WORKFLOW_MIME_WHITELIST.has(file.mimetype)) cb(null, true);
    else cb(new BadRequestException('Formato no permitido. Use PDF, DOCX, XLSX o imagen (PNG, JPG, WEBP, GIF, BMP, TIFF).'), false);
  },
};

@ApiTags('Workflow Files')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/v1/documents/:orgId/workflow-files')
@UseGuards(JwtGuard)
@OrgMember()
export class WorkflowFilesController {
  constructor(private readonly service: WorkflowFilesService) {}

  @ApiOperation({ summary: 'Subir un archivo adjunto al flujo de trabajo (sin extracción)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: WorkflowFileUploadResponseDto })
  @Post()
  @UseInterceptors(FileInterceptor('file', workflowMulterOptions))
  async upload(
    @Param('orgId') orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<WorkflowFileUploadResponseDto> {
    if (!file) throw new BadRequestException('El archivo es requerido');
    return this.service.upload(orgId, file);
  }

  @ApiOperation({ summary: 'Obtener URL firmada de descarga para un archivo de workflow' })
  @ApiOkResponse({ schema: { example: { signedUrl: 'https://...', expiresAt: '2025-01-01T00:00:00Z' } } })
  @Post('signed-url')
  async getSignedUrl(
    @Param('orgId') orgId: string,
    @Body('storageKey') storageKey: string,
    @Body('originalName') originalName?: string,
    @Body('mimeType') mimeType?: string,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    if (!storageKey) throw new BadRequestException('storageKey es requerido');
    return this.service.getSignedUrl(orgId, storageKey, originalName, mimeType);
  }

  @ApiOperation({ summary: 'Descargar múltiples archivos del workflow como un ZIP' })
  @ApiProduces('application/zip')
  @Post('download-zip')
  async downloadZip(
    @Param('orgId') orgId: string,
    @Body() body: DownloadZipDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } = await this.service.downloadZip(orgId, body.files, body.title);
    const isAscii = /^[\x20-\x7E]*$/.test(filename);
    const disposition = isAscii
      ? `attachment; filename="${filename}"`
      : `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', disposition);
    return new StreamableFile(stream);
  }
}
