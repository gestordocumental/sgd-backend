import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface JwtPayload {
  sub?: string;
  email?: string;
  companyId?: string;
  isSuperAdmin?: boolean;
}

/**
 * Extrae el payload del JWT sin re-verificar la firma.
 * Kong ya verificó la firma antes de reenviar la petición.
 * En llamadas directas (dev/test) la firma se verifica en JwtGuard.
 */
export const JwtPayloadParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const auth = request.headers['authorization'];

    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const parts = auth.split(' ')[1].split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed token');

    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Malformed token');
    }
  },
);
