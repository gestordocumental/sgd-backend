import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
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

  private verifyToken(token: string | undefined): void {
    const expected = Buffer.from(
      this.configService.getOrThrow<string>('INTERNAL_TOKEN'),
    );
    const provided = Buffer.from(token ?? '');
    const valid =
      provided.length === expected.length && timingSafeEqual(expected, provided);
    if (!valid) throw new UnauthorizedException();
  }

  @ApiOperation({ summary: 'Find users by org position (internal only)' })
  @ApiSecurity('internal-token')
  @Post('by-position')
  async byPosition(
    @Headers('x-internal-token') token: string | undefined,
    @Body() dto: ByPositionDto,
  ) {
    this.verifyToken(token);
    const { orgId, cargoId, areaId, departamentoId } = dto;
    return this.usersService.findByPosition(orgId, { cargoId, areaId, departamentoId });
  }
}
