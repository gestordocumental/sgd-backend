import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Extracts companyId from the JWT payload (Authorization: Bearer <token>).
 * Kong already verified the signature — this just reads the claim.
 *
 * Throws UnauthorizedException if no valid token is present.
 * Throws ForbiddenException if the token has no companyId (global token —
 * caller must switch-company first to get a scoped token).
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string>;
      query?: Record<string, unknown>;
    }>();
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

    const companyId = payload.companyId as string | undefined;
    if (companyId) return companyId;

    // Super-admin tokens have no companyId. Allow passing it as a query param
    // only for explicit super-admin requests scoped to a concrete org UUID.
    const isSuperAdmin = payload.isSuperAdmin === true;
    const queryOrgId = request.query?.orgId;
    const isUuid =
      typeof queryOrgId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        queryOrgId,
      );

    if (isSuperAdmin && isUuid) return queryOrgId;

    throw new ForbiddenException(
      'Token has no companyId — call POST /api/auth/switch-company first',
    );
  },
);
