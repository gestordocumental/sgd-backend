import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PermissionsService } from './permissions.service';

@Controller('api/permissions')
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService,
  ) {}

  // Returns all available permissions — orgs use this list to build custom roles
  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }

  /**
   * Internal endpoint called by other microservices to check whether the user
   * identified by the Authorization JWT has the given permission in their org.
   *
   * Requires x-internal-token header — not exposed to end users via Kong.
   */
  @Get('check')
  async check(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('module') module: string,
    @Query('action') action: string,
  ): Promise<{ allowed: boolean }> {
    // Validate internal token
    const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
    const provided = Buffer.from(internalToken ?? '');
    const isValid =
      provided.length === expected.length && timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException('Invalid internal token');

    // Decode user JWT (signature already verified by Kong)
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing user token');
    }
    const parts = authorization.split(' ')[1].split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed token');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    // Super admin always allowed
    if (payload.isSuperAdmin) return { allowed: true };

    const userId = payload.sub as string | undefined;
    const companyId = payload.companyId as string | undefined;

    if (!userId) throw new UnauthorizedException('Token has no sub claim');
    if (!companyId) {
      throw new ForbiddenException(
        'Token has no companyId — call POST /api/auth/switch-company first',
      );
    }

    const allowed = await this.permissionsService.checkUserPermission(
      userId,
      companyId,
      module,
      action,
    );

    return { allowed };
  }
}
