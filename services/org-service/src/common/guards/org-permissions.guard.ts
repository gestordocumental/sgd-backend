import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ORG_PERMISSION_KEY, OrgPermissionMeta } from '../decorators/require-org-permission.decorator';

@Injectable()
export class OrgPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<OrgPermissionMeta | undefined>(
      ORG_PERMISSION_KEY,
      ctx.getHandler(),
    );

    // No permission requirement on this endpoint — pass through
    if (!required) return true;

    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();

    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const parts = auth.split(' ')[1].split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed token');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    // Super admin bypasses permission checks
    if (payload.isSuperAdmin) return true;

    // Delegate the DB-backed permission check to user-service
    const userServiceUrl = this.configService.getOrThrow<string>('USER_SERVICE_URL');
    const internalToken = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const url = `${userServiceUrl}/api/permissions/check?module=${required.module}&action=${required.action}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          authorization: auth,
          'x-internal-token': internalToken,
        },
      });
    } catch (err) {
      throw new InternalServerErrorException(
        'Could not reach user-service to verify permissions',
      );
    }

    if (!response.ok) {
      if (response.status === 401) throw new UnauthorizedException('Invalid token');
      if (response.status === 403) throw new ForbiddenException('Insufficient permissions');
      throw new InternalServerErrorException('Permission check failed');
    }

    const body = (await response.json()) as { allowed: boolean };
    if (!body.allowed) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}
