import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Extracts the caller's userId (sub claim) from the JWT payload.
 * Kong already verified the signature — this just reads the claim.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const auth = request.headers['authorization'];

    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const parts = auth.split(' ')[1].split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    const sub = payload.sub as string | undefined;
    if (!sub) {
      throw new UnauthorizedException('Token has no sub claim');
    }

    return sub;
  },
);
