import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { OrgResponseDto } from './dto/org-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { SuperAdminOnly, OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';

/** Extracts the userId from the JWT without verifying the signature (Kong already verified it). */
function extractUserId(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(authHeader.split(' ')[1].split('.')[1], 'base64url').toString('utf8'),
    );
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

@Controller('api/org')
@UseGuards(OrgGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  /**
   * Create an organization.
   * Super admin only.
   */
  @Post()
  @SuperAdminOnly()
  async create(
    @Headers('authorization') auth: string,
    @Body() dto: CreateOrgDto,
  ): Promise<OrgResponseDto> {
    const createdBy = extractUserId(auth);
    if (!createdBy) {
      throw new InternalServerErrorException('Could not extract caller identity from token');
    }
    return OrgResponseDto.from(await this.orgsService.create(dto, createdBy));
  }

  /**
   * List all organizations.
   * Super admin only.
   */
  @Get()
  @SuperAdminOnly()
  async findAll(): Promise<OrgResponseDto[]> {
    return (await this.orgsService.findAll()).map(OrgResponseDto.from);
  }

  /**
   * Get an organization by ID.
   * Super admin, org member, or internal call (x-internal-token).
   */
  @Get(':id')
  @OrgMemberOrSuperAdmin()
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.findOne(id));
  }

  /**
   * Update an organization.
   * Super admin or org member (to update data for their own org).
   */
  @Patch(':id')
  @OrgMemberOrSuperAdmin()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrgDto,
  ): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.update(id, dto));
  }

  /**
   * Delete (soft delete) an organization.
   * Super admin only.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SuperAdminOnly()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orgsService.remove(id);
  }

  /**
   * Restore a deleted organization.
   * Super admin only.
   */
  @Post(':id/restore')
  @SuperAdminOnly()
  async restore(@Param('id', ParseUUIDPipe) id: string): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.restore(id));
  }
}
