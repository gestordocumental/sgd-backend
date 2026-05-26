import {
  BadRequestException,
  Controller,
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
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard, OrgMember } from '@sgd/common';
import { BulkImportResponseDto } from './dto/bulk-import-response.dto';
import { BulkImportService } from './bulk-import.service';

const ALLOWED_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

@ApiTags('Typologies Bulk Import')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/v1/documents/:orgId/typologies/bulk')
@UseGuards(JwtGuard)
@OrgMember()
export class BulkImportController {
  constructor(private readonly service: BulkImportService) {}

  @ApiOperation({ summary: 'Bulk import typologies from an Excel file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Excel file with typologies to import',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Bulk import finished', type: BulkImportResponseDto })
  @ApiBadRequestResponse({ description: 'Missing file, invalid Excel file or validation error' })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Solo se permiten archivos .xlsx o .xls'), false);
        }
      },
    }),
  )
  async bulkImport(
    @Param('orgId') orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<BulkImportResponseDto> {
    if (!file) throw new BadRequestException('El archivo Excel es requerido');
    return this.service.importFromExcel(orgId, file.buffer);
  }
}
