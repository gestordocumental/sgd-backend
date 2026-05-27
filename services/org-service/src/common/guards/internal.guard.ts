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
 *
 * Validates the provided token against the whitelist of known caller tokens.
 * Each token is specific to one (caller → org-service) pair:
 *   INTERNAL_TOKEN_NOTIF_ORG  — notification-service
 *   INTERNAL_TOKEN_DOC_ORG    — document-service
 *   INTERNAL_TOKEN_USER_ORG   — user-service
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly allowedTokens: Buffer[];

  constructor(configService: ConfigService) {
    const keys = ['INTERNAL_TOKEN_NOTIF_ORG', 'INTERNAL_TOKEN_DOC_ORG', 'INTERNAL_TOKEN_USER_ORG'];
    this.allowedTokens = keys
      .map((k) => configService.get<string>(k))
      .filter((t): t is string => !!t)
      .map((t) => Buffer.from(t));

    if (this.allowedTokens.length === 0) {
      throw new Error(
        'InternalGuard: no internal tokens configured (INTERNAL_TOKEN_NOTIF_ORG, INTERNAL_TOKEN_DOC_ORG, INTERNAL_TOKEN_USER_ORG)',
      );
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = request.headers['x-internal-token'];

    if (!provided) throw new UnauthorizedException('Missing x-internal-token');

    const providedBuf = Buffer.from(provided);
    const isValid = this.allowedTokens.some(
      (expected) =>
        providedBuf.length === expected.length &&
        timingSafeEqual(expected, providedBuf),
    );

    if (!isValid) throw new UnauthorizedException('Invalid x-internal-token');

    return true;
  }
}
