import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../common/guards/jwt.guard';
import { SuperAdminOnly } from '../common/decorators/auth.decorator';
import { TypologiesService } from './typologies.service';

@ApiTags('Typologies (Admin)')
@ApiBearerAuth('JWT')
@Controller('api/documents/admin')
@UseGuards(JwtGuard)
@SuperAdminOnly()
export class AdminTypologiesController {
  constructor(private readonly service: TypologiesService) {}

  @ApiOperation({ summary: 'Storage usage per organization — super admin only' })
  @ApiOkResponse({
    schema: {
      example: [{ orgId: 'uuid', storageTotalBytes: 10485760, uploadedDocuments: 12 }],
    },
  })
  @Get('storage-per-org')
  getStoragePerOrg() {
    return this.service.getStoragePerOrg();
  }
}
