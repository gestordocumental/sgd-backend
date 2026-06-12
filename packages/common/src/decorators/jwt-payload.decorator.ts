import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  email?: string;
  companyId?: string;
  isSuperAdmin?: boolean;
  /** Flat permission strings embedded in company-scoped tokens. Format: "MODULE:ACTION" */
  permissions?: string[];
}

export function jwtPayloadFactory(_data: unknown, ctx: ExecutionContext): JwtPayload {
  const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
  if (!request.user) throw new UnauthorizedException('Missing authenticated user');
  if (!request.user.sub) throw new UnauthorizedException('Missing user identifier');
  return request.user;
}

/**
 * Extracts the verified JWT payload from request.user, which was populated
 * by JwtGuard after signature verification. Never re-decodes the token.
 */
export const JwtPayloadParam = createParamDecorator(jwtPayloadFactory);
