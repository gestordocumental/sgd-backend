import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
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
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard, OrgMember } from '@sgd/common';
import { MAX_FILE_SIZE } from '../document-upload/document-upload.constants';
import { WorkflowFilesService } from './workflow-files.service';
import { WorkflowFileUploadResponseDto } from './dto/workflow-file-upload-response.dto';

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
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    if (!storageKey) throw new BadRequestException('storageKey es requerido');
    return this.service.getSignedUrl(orgId, storageKey);
  }
}
