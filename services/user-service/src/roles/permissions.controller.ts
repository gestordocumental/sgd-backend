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
   * Called by other microservices (e.g. org-service). Accepts explicit userId/orgId
   * instead of re-parsing a JWT, so caller cannot supply crafted claims.
   *
   * Protected by x-internal-token only. Never exposed to end users via Kong.
   *
   * Super-admin status is verified directly against the DB — never trusted
   * from caller-supplied query params to prevent privilege escalation.
   */
  @Get('check')
  async check(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Query('userId') userId: string,
    @Query('orgId') orgId: string,
    @Query('module') module: string,
    @Query('action') action: string,
  ): Promise<{ allowed: boolean }> {
    const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
    const provided = Buffer.from(internalToken ?? '');
    const isValid =
      provided.length === expected.length && timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException('Invalid internal token');

    // Verify super-admin status from the database, not from caller params
    if (await this.permissionsService.isUserSuperAdmin(userId)) {
      return { allowed: true };
    }

    const allowed = await this.permissionsService.checkUserPermission(
      userId,
      orgId,
      module,
      action,
    );

    return { allowed };
  }
}
