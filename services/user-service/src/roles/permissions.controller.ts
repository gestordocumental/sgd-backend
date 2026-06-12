import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PermissionsService } from './permissions.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from './entities/permission.entity';

@ApiTags('Permissions')
@Controller('api/v1/permissions')
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'List all available permissions — used by orgs to build custom roles' })
  @ApiBearerAuth('JWT')
  @ApiResponse({ status: 200, description: 'Array of permissions' })
  @UseGuards(PermissionsGuard)
  @RequirePermission(PermissionModule.ROLES, PermissionAction.READ)
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
  @ApiOperation({ summary: 'Check if a user has a permission in their org (internal only)' })
  @ApiSecurity('internal-token')
  @ApiQuery({ name: 'userId', type: String })
  @ApiQuery({ name: 'orgId', type: String })
  @ApiQuery({ name: 'module', type: String })
  @ApiQuery({ name: 'action', type: String })
  @ApiResponse({ status: 200, schema: { example: { allowed: true } } })
  @Get('check')
  async check(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Query('userId') userId: string,
    @Query('orgId') orgId: string,
    @Query('module') module: string,
    @Query('action') action: string,
  ): Promise<{ allowed: boolean }> {
    // org-service is the sole caller of this endpoint (via OrgPermissionsGuard).
    const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN_ORG_USER'));
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
