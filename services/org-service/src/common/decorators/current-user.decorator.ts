import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the `sub` claim from the verified JWT payload stored on `request.user`
 * by OrgGuard. Never re-parses or re-verifies the token.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: Record<string, unknown> }>();
    return request.user?.['sub'] as string | undefined;
  },
);
