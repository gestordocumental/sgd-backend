import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the `sub` claim from the verified JWT payload stored on `request.user`
 * by JwtGuard. Never re-parses or re-verifies the token.
 */
export const currentUserFactory = (_data: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest<{ user?: Record<string, unknown> }>();
  return request.user?.['sub'] as string | undefined;
};

export const CurrentUser = createParamDecorator(currentUserFactory);
