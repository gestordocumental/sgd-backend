import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Manages JWT signing keys with multi-key support for zero-downtime rotation.
 *
 * Rotation procedure:
 *   1. Generate a new secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. In Railway: set JWT_SECRET_PREV=<old JWT_SECRET>, JWT_SECRET_PREV_KID=<old JWT_SECRET_KID>,
 *      JWT_SECRET=<new secret>, JWT_SECRET_KID=<new ID> (e.g. "v2").
 *   3. Deploy. New tokens carry kid="v2"; tokens issued before rotation carry kid="v1" and are
 *      verified against JWT_SECRET_PREV during the grace window.
 *   4. After JWT_EXPIRATION has elapsed (all old tokens expired), remove JWT_SECRET_PREV and
 *      JWT_SECRET_PREV_KID.
 *   Same procedure applies to JWT_REFRESH_SECRET / JWT_REFRESH_SECRET_KID.
 */
@Injectable()
export class JwtKeyService {
  private readonly activeAccessKid: string;
  private readonly activeAccessSecret: string;
  private readonly graceAccessKid: string | null;
  private readonly graceAccessSecret: string | null;

  private readonly activeRefreshKid: string;
  private readonly activeRefreshSecret: string;
  private readonly graceRefreshKid: string | null;
  private readonly graceRefreshSecret: string | null;

  constructor(config: ConfigService) {
    this.activeAccessKid    = config.get<string>('JWT_SECRET_KID')          ?? 'v1';
    this.activeAccessSecret = config.getOrThrow<string>('JWT_SECRET');
    this.graceAccessKid     = config.get<string>('JWT_SECRET_PREV_KID')     ?? null;
    this.graceAccessSecret  = config.get<string>('JWT_SECRET_PREV')         ?? null;

    this.activeRefreshKid    = config.get<string>('JWT_REFRESH_SECRET_KID')      ?? 'v1';
    this.activeRefreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.graceRefreshKid     = config.get<string>('JWT_REFRESH_SECRET_PREV_KID') ?? null;
    this.graceRefreshSecret  = config.get<string>('JWT_REFRESH_SECRET_PREV')     ?? null;
  }

  get accessKid(): string { return this.activeAccessKid; }
  get accessSecret(): string { return this.activeAccessSecret; }
  get refreshKid(): string { return this.activeRefreshKid; }
  get refreshSecret(): string { return this.activeRefreshSecret; }

  /**
   * Returns the correct access-token signing secret for the given kid.
   * Undefined / missing kid is treated as the active key (legacy tokens issued
   * before kid support was added will continue to work).
   */
  resolveAccessSecret(kid?: string): string {
    if (!kid || kid === this.activeAccessKid) return this.activeAccessSecret;
    if (this.graceAccessKid && kid === this.graceAccessKid && this.graceAccessSecret) {
      return this.graceAccessSecret;
    }
    throw new UnauthorizedException('Unknown token key ID');
  }

  /** Same as resolveAccessSecret but for refresh tokens. */
  resolveRefreshSecret(kid?: string): string {
    if (!kid || kid === this.activeRefreshKid) return this.activeRefreshSecret;
    if (this.graceRefreshKid && kid === this.graceRefreshKid && this.graceRefreshSecret) {
      return this.graceRefreshSecret;
    }
    throw new UnauthorizedException('Unknown token key ID');
  }
}
