import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Socket } from 'net';
import { INTERNAL_TOKEN_KEYS_META } from '../decorators/internal-token.decorator';

// ── CIDR helpers (IPv4 only; extend if IPv6 private ranges are needed) ────────

function ipv4ToUint32(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | parseInt(octet, 10)) >>> 0, 0) >>> 0;
}

/**
 * Returns true when `ip` falls inside `cidr`.
 * Handles IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) transparently.
 * Single IP literals (no `/`) are treated as /32 CIDR.
 */
function cidrContains(cidr: string, ip: string): boolean {
  // Strip IPv4-mapped IPv6 prefix so ::ffff:100.64.1.2 → 100.64.1.2
  const normalizedIp = ip.replace(/^::ffff:/i, '');

  // Loopback aliases
  if (cidr === '::1' && (ip === '::1' || normalizedIp === '127.0.0.1')) return true;
  if (cidr === '127.0.0.1' && normalizedIp === '127.0.0.1') return true;

  if (!cidr.includes('.')) return cidr === ip || cidr === normalizedIp; // bare IPv6 literal

  const [rangeIp, prefixStr] = cidr.includes('/') ? cidr.split('/') : [cidr, '32'];
  const prefix = parseInt(prefixStr, 10);

  if (!normalizedIp.includes('.')) return false; // IPv6 src, IPv4 CIDR — no match

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToUint32(normalizedIp) & mask) === (ipv4ToUint32(rangeIp) & mask);
}

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * InternalGuard — defense-in-depth for service-to-service `/internal/*` endpoints.
 *
 * Two independent checks (both must pass when configured):
 *
 * 1. **Source-IP allowlist** (opt-in): If `INTERNAL_ALLOWED_CIDRS` is set
 *    (comma-separated CIDR blocks, e.g. `100.64.0.0/10,127.0.0.1`), the TCP
 *    source address is checked against the list.  Uses `socket.remoteAddress`
 *    instead of `x-forwarded-for` to prevent header spoofing.
 *    Railway private network: `100.64.0.0/10`.
 *    If the env var is absent the IP check is skipped (backwards-compatible).
 *
 * 2. **Token check**: The `x-internal-token` header must match one of the
 *    values declared via `@AllowInternalTokens(...envKeys)` on the handler.
 *
 * Usage:
 * ```typescript
 * @UseGuards(InternalGuard)
 * @AllowInternalTokens('INTERNAL_TOKEN_FOO_BAR')
 * @Post('internal/some-endpoint')
 * handle() {}
 * ```
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly allowedCidrs: string[];
  private readonly logger = new Logger(InternalGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('INTERNAL_ALLOWED_CIDRS') ?? '';
    this.allowedCidrs = raw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    if (this.allowedCidrs.length === 0) {
      this.logger.warn(
        'INTERNAL_ALLOWED_CIDRS is not set — source-IP check disabled. ' +
        'Set to Railway private CIDR (100.64.0.0/10) in production.',
      );
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<{
      socket: Pick<Socket, 'remoteAddress'>;
      headers: Record<string, string | string[] | undefined>;
    }>();

    // ── 1. Source-IP check ───────────────────────────────────────────────────
    if (this.allowedCidrs.length > 0) {
      const sourceIp = request.socket.remoteAddress ?? '';
      const ipAllowed = this.allowedCidrs.some((cidr) => cidrContains(cidr, sourceIp));
      if (!ipAllowed) {
        this.logger.warn(`Blocked internal request from disallowed IP: ${sourceIp}`);
        throw new ForbiddenException('Request origin not in internal allowlist');
      }
    }

    // ── 2. Token check ───────────────────────────────────────────────────────
    const raw = request.headers['x-internal-token'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) throw new UnauthorizedException('Missing x-internal-token');

    const keys =
      this.reflector.getAllAndOverride<string[] | undefined>(INTERNAL_TOKEN_KEYS_META, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];

    const allowed = keys
      .map((k) => this.configService.get<string>(k))
      .filter((t): t is string => !!t)
      .map((t) => Buffer.from(t));

    if (allowed.length === 0) {
      throw new UnauthorizedException('No internal tokens configured for this endpoint');
    }

    const providedBuf = Buffer.from(provided);
    const valid = allowed.some(
      (expected) =>
        providedBuf.length === expected.length && timingSafeEqual(expected, providedBuf),
    );

    if (!valid) throw new UnauthorizedException('Invalid x-internal-token');
    return true;
  }
}
