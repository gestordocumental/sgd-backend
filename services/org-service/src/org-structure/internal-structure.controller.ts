import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalGuard } from '../common/guards/internal.guard';
import { BulkStructureService } from './bulk-structure.service';
import { ResolveStructureRequestDto } from './dto/resolve-structure-request.dto';
import { ResolveStructureResponseDto } from './dto/resolve-structure-response.dto';

@ApiTags('Internal Structure')
@ApiSecurity('internal-token')
@Controller('internal')
@UseGuards(InternalGuard)
export class InternalStructureController {
  constructor(private readonly service: BulkStructureService) {}

  @ApiOperation({ summary: 'Resolve department, area and position values for internal service-to-service calls' })
  @ApiBody({ type: ResolveStructureRequestDto })
  @ApiOkResponse({ description: 'Resolved org structure identifiers', type: ResolveStructureResponseDto })
  @Post('structure/resolve')
  resolve(@Body() dto: ResolveStructureRequestDto): Promise<ResolveStructureResponseDto> {
    return this.service.resolveStructure(dto);
  }
}
