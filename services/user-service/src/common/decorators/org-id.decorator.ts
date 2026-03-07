import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const orgId = request.headers['x-org-id'];
    if (!orgId) throw new BadRequestException('x-org-id header is required');
    return orgId;
  },
);
