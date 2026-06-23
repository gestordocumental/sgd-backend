import {
  Controller,
  Post,
  Body,
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

  @ApiOperation({ summary: 'Fetch multiple users by IDs in a single call (internal only)' })
  @ApiSecurity('internal-token')
  @AllowInternalTokens('INTERNAL_TOKEN_NOTIF_USER')
  @Post('batch-by-ids')
  async batchByIds(@Body() body: { ids: string[] }) {
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500) {
      throw new BadRequestException('ids must be a non-empty array of at most 500 entries');
    }
    if (!body.ids.every((id) => typeof id === 'string' && id.length > 0)) {
      throw new BadRequestException('Each id must be a non-empty string');
    }
    const users = await this.usersService.findManyByIds(body.ids);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
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
}
