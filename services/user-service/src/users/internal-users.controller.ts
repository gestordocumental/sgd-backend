import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { UsersService } from './users.service';

class ByPositionDto {
  orgId!: string;
  cargoId?: string;
  areaId?: string | null;
  departamentoId?: string;
}

@ApiTags('Internal')
@Controller('internal/users')
export class InternalUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  private verifyToken(token: string | undefined, keys: string[]): void {
    const allowed = keys
      .map((k) => this.configService.get<string>(k))
      .filter((t): t is string => !!t)
      .map((t) => Buffer.from(t));

    const provided = Buffer.from(token ?? '');
    const valid = allowed.some(
      (expected) =>
        provided.length === expected.length && timingSafeEqual(expected, provided),
    );
    if (!valid) throw new UnauthorizedException();
  }

  @ApiOperation({ summary: 'Fetch multiple users by IDs in a single call (internal only)' })
  @ApiSecurity('internal-token')
  @Post('batch-by-ids')
  async batchByIds(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { ids: string[] },
  ) {
    // Only notification-service is authorized to call this endpoint
    this.verifyToken(token, ['INTERNAL_TOKEN_NOTIF_USER']);
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
  @Post('by-position')
  async byPosition(
    @Headers('x-internal-token') token: string | undefined,
    @Body() dto: ByPositionDto,
  ) {
    // Only workflow-service is authorized to call this endpoint
    this.verifyToken(token, ['INTERNAL_TOKEN_WORKFLOW_USER']);
    const { orgId, cargoId, departamentoId } = dto;
    const filters: { cargoId?: string; areaId?: string | null; departamentoId?: string } = { cargoId, departamentoId };
    if (dto.areaId !== undefined) filters.areaId = dto.areaId;
    return this.usersService.findByPosition(orgId, filters);
  }
}
