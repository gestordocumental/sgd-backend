import {
  Controller,
  Post,
  Param,
  ParseUUIDPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam,
  ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { BulkStructureService } from './bulk-structure.service';
import { BulkStructureResponseDto } from './dto/bulk-structure-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { OrgPermissionsGuard } from '../common/guards/org-permissions.guard';
import { OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { RequireOrgPermission } from '../common/decorators/require-org-permission.decorator';

const ALLOWED_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

@ApiTags('Org Structure — Bulk Import')
@ApiBearerAuth('JWT')
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('api/org/:orgId/structure')
@UseGuards(OrgGuard, OrgPermissionsGuard)
@OrgMemberOrSuperAdmin()
export class BulkStructureController {
  constructor(private readonly service: BulkStructureService) {}

  @ApiOperation({ summary: 'Bulk import org structure (departments, areas, positions) from Excel' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Excel file (.xlsx, .xls) — max 5 MB' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Import summary with counts of created/existing entities', type: BulkStructureResponseDto })
  @Post('bulk')
  @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
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
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<BulkStructureResponseDto> {
    if (!file) throw new BadRequestException('El archivo Excel es requerido');
    return this.service.importFromExcel(orgId, file.buffer);
  }
}
