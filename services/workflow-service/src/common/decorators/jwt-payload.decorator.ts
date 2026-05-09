import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  email?: string;
  companyId?: string;
  isSuperAdmin?: boolean;
}

/**
 * Extrae el payload del JWT desde request.user, que fue asignado por JwtGuard
 * tras verificar la firma. Nunca re-decodifica el token directamente.
 * Lanza UnauthorizedException si el usuario o su identificador (sub) no están presentes.
 */
export function jwtPayloadFactory(
  _data: unknown,
  ctx: ExecutionContext,
): JwtPayload {
  const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
  if (!request.user) throw new UnauthorizedException('Missing authenticated user');
  if (!request.user.sub) throw new UnauthorizedException('Missing user identifier');
  return request.user;
}

export const JwtPayloadParam = createParamDecorator(jwtPayloadFactory);
