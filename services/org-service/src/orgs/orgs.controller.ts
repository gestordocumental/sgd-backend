import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrgsService } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { OrgResponseDto } from './dto/org-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { SuperAdminOnly, OrgMemberOrSuperAdmin, AuthOnly } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Organizations')
@ApiBearerAuth('JWT')
@Controller('api/v1/org')
@UseGuards(OrgGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @ApiOperation({ summary: 'Create an organization (super admin only)' })
  @ApiBody({ type: CreateOrgDto })
  @ApiResponse({ status: 201, description: 'Organization created', type: OrgResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 409, description: 'Organization name already exists' })
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
      throw new UnauthorizedException('Could not extract caller identity from token');
    }
    return OrgResponseDto.from(await this.orgsService.create(dto, createdBy));
  }

  @ApiOperation({ summary: 'List all organizations (paginated, with server-side search and status filter)' })
  @ApiResponse({ status: 200, description: 'Paginated organizations' })
  /**
   * List all organizations.
   * Super admin only.
   */
  @Get()
  @SuperAdminOnly()
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ): Promise<{ data: OrgResponseDto[]; total: number }> {
    if (page < 1) throw new BadRequestException('page must be >= 1');
    if (limit < 1 || limit > 500) throw new BadRequestException('limit must be between 1 and 500');
    if (status && !['active', 'inactive', 'deleted'].includes(status)) {
      throw new BadRequestException('status must be one of: active, inactive, deleted');
    }

    const { data, total } = await this.orgsService.findAll({
      page,
      limit,
      search,
      status: status as 'active' | 'inactive' | 'deleted' | undefined,
    });
    return { data: data.map(OrgResponseDto.from), total };
  }

  @ApiOperation({ summary: 'Resolve org details for a list of IDs (used by profile context-switcher)' })
  @ApiResponse({ status: 200, description: 'Returns full org data for each ID provided', type: OrgResponseDto, isArray: true })
  /**
   * Accepts a comma-separated list of org IDs via ?ids=a,b,c and returns full org data.
   * Requires a valid JWT but no org-scope restriction — the caller (frontend) already
   * received these IDs from /auth/me/companies and needs name, status, nit, etc.
   */
  @Get('mine')
  @AuthOnly()
  async getMyOrgs(
    @Query('ids') idsParam?: string,
  ): Promise<OrgResponseDto[]> {
    const ids = idsParam?.split(',').filter(Boolean) ?? [];
    const orgs = await this.orgsService.findByIds(ids);
    return orgs.map(OrgResponseDto.from);
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
  @ApiBody({ type: UpdateOrgDto })
  @ApiResponse({ status: 200, description: 'Organization updated', type: OrgResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  /**
   * Update an organization.
   * Super admin or org member (to update data for their own org).
   */
  @Patch(':id')
  @OrgMemberOrSuperAdmin()
  async update(
    @CurrentUser() actorId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrgDto,
  ): Promise<OrgResponseDto> {
    if (!actorId) throw new UnauthorizedException('Could not extract caller identity from token');
    return OrgResponseDto.from(await this.orgsService.update(id, dto, actorId));
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
  async remove(
    @CurrentUser() actorId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    if (!actorId) throw new UnauthorizedException('Could not extract caller identity from token');
    return this.orgsService.remove(id, actorId);
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
  async restore(
    @CurrentUser() actorId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrgResponseDto> {
    if (!actorId) throw new UnauthorizedException('Could not extract caller identity from token');
    return OrgResponseDto.from(await this.orgsService.restore(id, actorId));
  }
}
