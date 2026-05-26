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
 * Extracts and validates the authenticated JWT payload from the current HTTP request.
 *
 * @returns The validated `JwtPayload` found on `request.user`
 * @throws UnauthorizedException If no authenticated user is present or the user's `sub` is missing
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
