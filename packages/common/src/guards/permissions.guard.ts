import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, type RequiredPermission } from '../decorators/require-permission.decorator';
import type { JwtPayload } from '../decorators/jwt-payload.decorator';

/**
 * Reads the permissions array already embedded in the JWT payload by auth-service
 * (populated at switchCompany time). No DB or HTTP calls — pure in-memory check.
 *
 * Must be used AFTER JwtGuard so request.user is already populated.
 *
 * Super-admins (isSuperAdmin === true) bypass all permission checks.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!required) return true;

    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user) throw new UnauthorizedException('Missing authenticated user');
    if (user.isSuperAdmin) return true;

    const permissions = user.permissions ?? [];
    const hasPermission = permissions.includes(`${required.module}:${required.action}`);

    if (!hasPermission) {
      throw new ForbiddenException(
        `Insufficient permissions: requires ${required.module}:${required.action}`,
      );
    }

    return true;
  }
}
