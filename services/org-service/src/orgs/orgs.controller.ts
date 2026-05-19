import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrgsService } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { OrgResponseDto } from './dto/org-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { SuperAdminOnly, OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Organizations')
@ApiBearerAuth('JWT')
@Controller('api/org')
@UseGuards(OrgGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @ApiOperation({ summary: 'Create an organization (super admin only)' })
  @ApiResponse({ status: 201, description: 'Organization created', type: OrgResponseDto })
  /**
   * Create an organization.
   * Super admin only.
   */
  @Post()
  @SuperAdminOnly()
  async create(
    @CurrentUser() createdBy: string | undefined,
    @Body() dto: CreateOrgDto,
  ): Promise<OrgResponseDto> {
    if (!createdBy) {
      throw new InternalServerErrorException('Could not extract caller identity from token');
    }
    return OrgResponseDto.from(await this.orgsService.create(dto, createdBy));
  }

  @ApiOperation({ summary: 'List all organizations (super admin only)' })
  @ApiResponse({ status: 200, description: 'Organizations found', type: OrgResponseDto, isArray: true })
  /**
   * List all organizations.
   * Super admin only.
   */
  @Get()
  @SuperAdminOnly()
  async findAll(): Promise<OrgResponseDto[]> {
    return (await this.orgsService.findAll()).map(OrgResponseDto.from);
  }

  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization found', type: OrgResponseDto })
  /**
   * Get an organization by ID.
   * Super admin, org member, or internal call (x-internal-token).
   */
  @Get(':id')
  @OrgMemberOrSuperAdmin()
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.findOne(id));
  }

  @ApiOperation({ summary: 'Update organization data' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization updated', type: OrgResponseDto })
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

  @ApiOperation({ summary: 'Soft delete an organization (super admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
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

  @ApiOperation({ summary: 'Restore a deleted organization (super admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Organization restored', type: OrgResponseDto })
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
