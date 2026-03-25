import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AUTH_KEY, AuthMeta } from '../decorators/auth.decorator';

@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const meta = this.reflector.get<AuthMeta | undefined>(AUTH_KEY, ctx.getHandler());

    // Endpoints sin decorador de auth pasan directamente (ej: health)
    if (!meta) return true;

    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string>;
      params: Record<string, string>;
    }>();

    // Llamadas internas entre microservicios — siempre permitidas
    const internalToken = request.headers['x-internal-token'];
    if (internalToken) {
      const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
      const provided = Buffer.from(internalToken);
      const isValid =
        provided.length === expected.length && timingSafeEqual(expected, provided);
      if (isValid) return true;
    }

    // Decodificar el JWT (Kong ya verificó la firma)
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

    // Super admin tiene acceso a todo
    if (payload.isSuperAdmin) return true;

    if (meta.superAdminOnly) {
      throw new ForbiddenException('Super admin access required');
    }

    if (meta.orgMember) {
      const companyId = payload.companyId as string | undefined;
      const orgId = request.params['id'];

      if (!companyId) {
        throw new ForbiddenException(
          'Token has no companyId — call POST /api/auth/switch-company first',
        );
      }
      if (companyId !== orgId) {
        throw new ForbiddenException('Access denied to this organization');
      }
      return true;
    }

    return true;
  }
}
