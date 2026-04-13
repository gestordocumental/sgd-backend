import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * InternalGuard — only allows requests with a valid x-internal-token header.
 * Used exclusively on /internal/* endpoints that must never be reachable via Kong.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = request.headers['x-internal-token'];

    if (!provided) throw new UnauthorizedException('Missing x-internal-token');

    const expected = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);

    const isValid =
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf);

    if (!isValid) throw new UnauthorizedException('Invalid x-internal-token');

    return true;
  }
}
