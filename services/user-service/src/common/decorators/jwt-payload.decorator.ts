import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface JwtPayload {
  sub?: string;
  companyId?: string;
  isSuperAdmin?: boolean;
}

/**
 * Extracts the decoded JWT payload (without verifying the signature).
 * Kong already verified the signature before forwarding the request.
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
