import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { InternalGuard, AllowInternalTokens } from '@sgd/common';
import { UsersService } from './users.service';

class ByPositionDto {
  orgId!: string;
  cargoId?: string;
  areaId?: string | null;
  departamentoId?: string;
}

@ApiTags('Internal')
@Controller('internal/users')
@UseGuards(InternalGuard)
export class InternalUsersController {
  constructor(private readonly usersService: UsersService) {}

  private validateBatchIds(body: { ids: string[] } | undefined | null): string[] {
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500) {
      throw new BadRequestException('ids must be a non-empty array of at most 500 entries');
    }
    if (!body.ids.every((id) => typeof id === 'string' && id.length > 0)) {
      throw new BadRequestException('Each id must be a non-empty string');
    }
    return body.ids;
  }

  // Returns email — restricted to notification-service, which needs it to
  // actually send notifications. Do NOT add other tokens here; any service
  // that only needs display names should use batch-display-names instead,
  // which never exposes email or falls back to it.
  @ApiOperation({ summary: 'Fetch multiple users by IDs in a single call (internal only)' })
  @ApiSecurity('internal-token')
  @AllowInternalTokens('INTERNAL_TOKEN_NOTIF_USER')
  @Post('batch-by-ids')
  async batchByIds(@Body() body: { ids: string[] }) {
    const ids = this.validateBatchIds(body);
    const users = await this.usersService.findManyByIds(ids);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
    }));
  }

  // Display-name-only contract for callers that resolve names for viewers who
  // don't hold USERS:READ (e.g. workflow-service's timeline/participant
  // names, audit-service's actor names). Deliberately excludes email and
  // never falls back to it — a user with no first/last name gets
  // displayName: null instead of leaking their email address to every
  // viewer of a workflow or audit log they're not otherwise entitled to see.
  @ApiOperation({ summary: 'Fetch multiple users\' display names by IDs, no email (internal only)' })
  @ApiSecurity('internal-token')
  @AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_USER', 'INTERNAL_TOKEN_AUDIT_USER')
  @Post('batch-display-names')
  async batchDisplayNames(@Body() body: { ids: string[] }) {
    const ids = this.validateBatchIds(body);
    const users = await this.usersService.findManyByIds(ids);
    return users.map((u) => ({
      id: u.id,
      displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
    }));
  }

  @ApiOperation({ summary: 'Find users by org position (internal only)' })
  @ApiSecurity('internal-token')
  @AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_USER')
  @Post('by-position')
  async byPosition(@Body() dto: ByPositionDto) {
    const { orgId, cargoId, departamentoId } = dto;
    const filters: { cargoId?: string; areaId?: string | null; departamentoId?: string } = { cargoId, departamentoId };
    if (dto.areaId !== undefined) filters.areaId = dto.areaId;
    return this.usersService.findByPosition(orgId, filters);
  }

  // Called by org-service before deleting a departamento/area/cargo, to block
  // the delete if a user's profile still references it. Deliberately a
  // separate endpoint from by-position above — see
  // UserProfileService.countByPosition()'s doc comment for why that one
  // can't be reused here (its role-assignment join would miss exactly the
  // users this check needs to catch).
  @ApiOperation({ summary: 'Count users referencing an org-structure position (internal only)' })
  @ApiSecurity('internal-token')
  @AllowInternalTokens('INTERNAL_TOKEN_ORG_USER')
  @Get('org-structure-references')
  async orgStructureReferences(
    @Query('departamentoId') departamentoId?: string,
    @Query('areaId') areaId?: string,
    @Query('cargoId') cargoId?: string,
  ) {
    const provided = [departamentoId, areaId, cargoId].filter((v) => v !== undefined);
    if (provided.length !== 1) {
      throw new BadRequestException(
        'Exactly one of departamentoId, areaId, or cargoId query params is required',
      );
    }

    const count = await this.usersService.countByPosition({ departamentoId, areaId, cargoId });
    return { count };
  }
}
