import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
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
   * Internal endpoint — checks whether a user has the given permission in their org.
   *
   * Called by other microservices (e.g. org-service) that have already decoded
   * and trust-verified the user's JWT. Accepts explicit userId / orgId query
   * params instead of re-parsing a JWT, eliminating the risk of a caller
   * supplying crafted claims.
   *
   * Protected by x-internal-token only. Never exposed to end users via Kong.
   *
   * Returns { allowed: true } for super-admins (isSuperAdmin query flag).
   */
  @Get('check')
  async check(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Query('userId') userId: string,
    @Query('orgId') orgId: string,
    @Query('module') module: string,
    @Query('action') action: string,
    @Query('isSuperAdmin') isSuperAdminParam: string | undefined,
  ): Promise<{ allowed: boolean }> {
    // Validate internal token
    const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
    const provided = Buffer.from(internalToken ?? '');
    const isValid =
      provided.length === expected.length && timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException('Invalid internal token');

    // Super admins have unrestricted access — the calling service asserts this
    // after verifying the JWT signature itself (or trusting Kong's verification).
    if (isSuperAdminParam === 'true') return { allowed: true };

    const allowed = await this.permissionsService.checkUserPermission(
      userId,
      orgId,
      module,
      action,
    );

    return { allowed };
  }
}
