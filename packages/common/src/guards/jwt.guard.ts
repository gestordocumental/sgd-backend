import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { verify, JsonWebTokenError } from 'jsonwebtoken';
import { AUTH_KEY, AuthMeta } from '../decorators/auth.decorator';
import { INTERNAL_TOKEN_KEYS_META } from '../decorators/internal-token.decorator';

/** Injection token for an optional super-admin revocation checker.
 *  Provide a function `(userId: string) => Promise<boolean>` that returns
 *  true when the user's super-admin privileges have been explicitly revoked
 *  and the current access token should be rejected immediately.
 *  Services that do not need instant revocation can omit this provider. */
export const SUPER_ADMIN_REVOCATION_CHECKER = 'SUPER_ADMIN_REVOCATION_CHECKER';

function verifyAndDecodeJwt(token: string, secret: string): Record<string, unknown> {
  try {
    return verify(token, secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
  } catch (err: unknown) {
    if (err instanceof JsonWebTokenError) throw new UnauthorizedException(err.message);
    throw err;
  }
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Optional() @Inject(SUPER_ADMIN_REVOCATION_CHECKER)
    private readonly revocationChecker?: (userId: string) => Promise<boolean>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<AuthMeta | undefined>(AUTH_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) return true;

    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string>;
      params: Record<string, string>;
      user?: Record<string, unknown>;
    }>();

    // Internal service-to-service calls bypass JWT validation only when the
    // endpoint explicitly opts in via @AllowInternalTokens(...envKeys).
    // Without the decorator, all x-internal-token headers are ignored and the
    // request falls through to normal JWT validation — a compromised service's
    // token cannot call endpoints that never declared it as a valid caller.
    const internalToken = request.headers['x-internal-token'];
    if (internalToken) {
      const declaredKeys = this.reflector.getAllAndOverride<string[] | undefined>(
        INTERNAL_TOKEN_KEYS_META,
        [ctx.getHandler(), ctx.getClass()],
      );
      // No decorator → reject all internal tokens (default-deny).
      const keysToCheck = declaredKeys ?? [];
      if (keysToCheck.length > 0) {
        const allowed = keysToCheck
          .map((k) => this.configService.get<string>(k))
          .filter((t): t is string => !!t)
          .map((t) => Buffer.from(t));
        const provided = Buffer.from(internalToken);
        if (allowed.some(
          (expected) =>
            provided.length === expected.length &&
            timingSafeEqual(new Uint8Array(expected), new Uint8Array(provided)),
        )) return true;
      }
    }

    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const payload = verifyAndDecodeJwt(
      auth.split(' ')[1],
      this.configService.getOrThrow<string>('JWT_SECRET'),
    );

    request.user = payload;

    if (payload['isSuperAdmin']) {
      // If a revocation checker is registered, verify the super-admin claim
      // hasn't been explicitly revoked (e.g. after setSuperAdmin(false)).
      if (this.revocationChecker) {
        const userId = payload['sub'] as string;
        const revoked = await this.revocationChecker(userId);
        if (revoked) throw new ForbiddenException('Super admin privileges have been revoked');
      }
      return true;
    }

    if (meta.superAdminOnly) throw new ForbiddenException('Super admin access required');

    if (meta.orgMember) {
      const companyId = payload['companyId'] as string | undefined;
      if (!companyId) {
        throw new ForbiddenException(
          'Token has no companyId — call POST /api/auth/switch-company first',
        );
      }
      const orgId = request.params['orgId'];
      if (orgId && companyId !== orgId) {
        throw new ForbiddenException('Access denied to this organization');
      }
    }

    return true;
  }
}
