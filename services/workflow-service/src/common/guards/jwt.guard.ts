import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { AUTH_KEY, AuthMeta } from '../decorators/auth.decorator';

function verifyAndDecodeJwt(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedException('Malformed token');
  const [header, payload, signature] = parts;
  const sigBytes      = Buffer.from(signature, 'base64url');
  const expectedBytes = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  if (sigBytes.length !== expectedBytes.length || !timingSafeEqual(sigBytes, expectedBytes)) {
    throw new UnauthorizedException('Invalid token');
  }
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('Malformed token');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof decoded['exp'] === 'number' && decoded['exp'] < now) {
    throw new UnauthorizedException('Token expired');
  }
  if (typeof decoded['nbf'] === 'number' && decoded['nbf'] > now) {
    throw new UnauthorizedException('Token not yet valid');
  }
  return decoded;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const meta = this.reflector.get<AuthMeta | undefined>(AUTH_KEY, ctx.getHandler());
    if (!meta) return true;

    const request = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; params: Record<string, string>; user?: Record<string, unknown> }>();

    // Llamadas internas entre microservicios — omitir validación JWT
    const internalToken = request.headers['x-internal-token'];
    if (internalToken) {
      const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
      const provided  = Buffer.from(internalToken);
      if (provided.length === expected.length && timingSafeEqual(expected, provided)) return true;
    }

    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    const payload   = verifyAndDecodeJwt(auth.split(' ')[1], jwtSecret);

    // Exponer el payload verificado en request.user para que los decoradores lo lean de forma segura
    request.user = payload;

    if (payload.isSuperAdmin) return true;
    if (meta.superAdminOnly) throw new ForbiddenException('Super admin access required');

    if (meta.orgMember) {
      const companyId = payload.companyId as string | undefined;
      const orgId     = request.params['orgId'];
      if (!companyId) {
        throw new ForbiddenException(
          'Token has no companyId — call POST /api/auth/switch-company first',
        );
      }
      if (orgId && companyId !== orgId) {
        throw new ForbiddenException('Access denied to this organization');
      }
    }

    return true;
  }
}
