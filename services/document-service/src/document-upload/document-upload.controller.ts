import {
  BadRequestException,
  Controller,
  Get,
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
import { OrgMember } from '../common/decorators/auth.decorator';
import { JwtGuard } from '../common/guards/jwt.guard';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { DocumentUploadService } from './document-upload.service';

@ApiTags('Document Upload')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@ApiParam({ name: 'id', description: 'MongoDB typology id' })
@Controller('api/documents/:orgId/typologies/:id/file')
@UseGuards(JwtGuard)
@OrgMember()
export class DocumentUploadController {
  constructor(private readonly service: DocumentUploadService) {}

  @ApiOperation({ summary: 'Upload a PDF, DOCX or DOC file for a typology' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file to upload',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document uploaded', type: DocumentUploadResponseDto })
  @ApiBadRequestResponse({ description: 'Missing file or invalid mimetype' })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Solo se permiten archivos PDF, DOCX o DOC'), false);
        }
      },
    }),
  )
  upload(
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<DocumentUploadResponseDto> {
    if (!file) throw new BadRequestException('El archivo es requerido');
    return this.service.upload(orgId, typologyId, file);
  }

  @ApiOperation({ summary: 'Get a temporary signed download URL for the uploaded file' })
  @ApiOkResponse({ description: 'Signed URL generated', type: SignedUrlResponseDto })
  @Get()
  getSignedUrl(
    @Param('orgId') orgId: string,
    @Param('id') typologyId: string,
  ): Promise<SignedUrlResponseDto> {
    return this.service.getSignedUrl(orgId, typologyId);
  }
}
