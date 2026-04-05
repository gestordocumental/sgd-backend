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

    // Super admin bypasses permission checks — Kong already verified the signature
    if (payload.isSuperAdmin) return true;

    const userId = payload.sub as string | undefined;
    const companyId = payload.companyId as string | undefined;

    if (!userId) throw new UnauthorizedException('Token has no sub claim');
    if (!companyId) {
      throw new ForbiddenException(
        'Token has no companyId — call POST /api/auth/switch-company first',
      );
    }

    // Delegate DB-backed permission check to user-service.
    // Pass userId and orgId as explicit params — no JWT forwarded — so
    // user-service never has to re-parse or re-trust JWT claims.
    const userServiceUrl = this.configService.getOrThrow<string>('USER_SERVICE_URL');
    const internalToken = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const url =
      `${userServiceUrl}/api/permissions/check` +
      `?userId=${encodeURIComponent(userId)}` +
      `&orgId=${encodeURIComponent(companyId)}` +
      `&module=${encodeURIComponent(required.module)}` +
      `&action=${encodeURIComponent(required.action)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'x-internal-token': internalToken },
      });
    } catch {
      throw new InternalServerErrorException(
        'Could not reach user-service to verify permissions',
      );
    } finally {
      clearTimeout(timeout);
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
