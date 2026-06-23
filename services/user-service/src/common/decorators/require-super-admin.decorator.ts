import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Validates that the caller is a super admin by decoding the JWT from the
 * Authorization header. Kong already verified the signature — this just
 * extracts the isSuperAdmin claim for authorization purposes.
 *
 * Throws UnauthorizedException if no valid token is present.
 * Throws ForbiddenException if the caller is not a super admin.
 */
export const RequireSuperAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): void => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const auth = request.headers['authorization'];

    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const parts = auth.split(' ')[1].split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    if (!payload.isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
    }
  },
);
