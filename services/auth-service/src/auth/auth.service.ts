import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "crypto";
import { Redis } from "ioredis";
import { Credential, CredentialStatus } from "./entities/credential.entity";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { LoginDto } from "./dto/login.dto";
import { UserClientService } from "../user-client/user-client.service";
import { JwtKeyService } from "./jwt-key.service";
import { AppLogger, KafkaProducerService, TOPICS, getCorrelationId } from "@sgd/common";
import { parseDurationToSeconds } from "./utils/parse-duration";

// Password reset token TTL: 1 hour
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

// Default bcrypt cost factor: ~250ms on modern hardware (OWASP-recommended).
// Acceptable range: 10–14. Values outside range fall back to default.
const DEFAULT_BCRYPT_ROUNDS = 12;

// Exponential lockout: after reaching each threshold of consecutive failures the
// account is locked for the corresponding duration.  Stages are evaluated
// highest-first so 15+ failures always gets the 1h lockout.
const LOCKOUT_STAGES = [
  { threshold:  5, durationMs:  5 * 60 * 1000 },   //  5 failures →  5 min
  { threshold: 10, durationMs: 15 * 60 * 1000 },   // 10 failures → 15 min
  { threshold: 15, durationMs: 60 * 60 * 1000 },   // 15 failures →  1 h
] as const;
// Counter auto-expires after 24 h of inactivity to prevent stale keys.
const FAILURE_COUNTER_TTL_SECONDS = 24 * 60 * 60;
// Short-lived cache for user-service data used in the login/refresh hot path.
// Allows auth to continue serving tokens for up to 60 s while user-service is unavailable.
const USER_DATA_CACHE_TTL_SECONDS = 60;

interface TokenOptions {
  companyId?: string;
  isSuperAdmin?: boolean;
  permissions?: string[];
}

interface JwtComplete {
  header: { kid?: string; [key: string]: unknown };
  payload: unknown;
  signature: string;
}

interface RefreshTokenPayload {
  sub: string;
  email: string;
  jti: string;
  iss: string;
  iat: number;
  exp: number;
  companyId?: string;
}

@Injectable()
export class AuthService {
  // Derived once from JWT_REFRESH_EXPIRATION so Redis TTL always matches the JWT expiry.
  private readonly refreshTtlSeconds: number;
  // bcrypt cost factor read from ConfigService so it can be overridden in tests.
  private readonly bcryptRounds: number;
  // Dummy hash to run bcrypt.compare even when no credential exists (timing equalization).
  private readonly dummyHash: string;

  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepo: Repository<Credential>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    private readonly userClientService: UserClientService,
    private readonly jwtKeyService: JwtKeyService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly logger: AppLogger,
  ) {
    this.refreshTtlSeconds = parseDurationToSeconds(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION'),
      43200, // fallback: 12 h
    );

    const rawRounds = this.configService.get<string>('BCRYPT_ROUNDS');
    const parsed = rawRounds != null ? Number.parseInt(rawRounds, 10) : DEFAULT_BCRYPT_ROUNDS;
    this.bcryptRounds = Number.isInteger(parsed) && parsed >= 10 && parsed <= 14
      ? parsed
      : DEFAULT_BCRYPT_ROUNDS;

    this.dummyHash = bcrypt.hashSync('__invalid_password__', this.bcryptRounds);
  }

  /**
   * Idempotent: creates credentials by email (global, not per-company).
   * Caller contract: only user-service (authenticated via x-internal-token) may invoke this.
   * userId is expected to be a valid, persisted user in user-service before this call is made;
   * the caller guarantees referential integrity across the service boundary.
   */
  async provisionCredentials(dto: ProvisionCredentialDto) {
    const existing = await this.credentialRepo.findOne({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.userId !== dto.userId) {
        throw new ConflictException(
          "Email already registered for another account",
        );
      }
      if (existing.status === CredentialStatus.DISABLED) {
        throw new ForbiddenException("Credentials disabled");
      }

      if (!existing.passwordHash) {
        existing.passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
        existing.status = CredentialStatus.ACTIVE;
        await this.credentialRepo.save(existing);
      }

      return { ok: true };
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const credential = this.credentialRepo.create({
      userId: dto.userId,
      email: dto.email,
      passwordHash,
      status: CredentialStatus.ACTIVE,
    });

    await this.credentialRepo.save(credential);
    return { ok: true };
  }

  /**
   * Global login — no companyId required.
   * Returns a global token; the frontend selects company via switch-company.
   */
  async login(dto: LoginDto) {
    const credential = await this.credentialRepo.findOne({
      where: { email: dto.email },
    });

    // Always run bcrypt.compare to prevent timing-based user enumeration.
    // Use this.dummyHash when credential is missing, inactive, or has no password yet
    // (invitation flow: user created but complete-registration not done).
    const hashToCheck = (credential?.status === CredentialStatus.ACTIVE && credential.passwordHash)
      ? credential.passwordHash
      : this.dummyHash;
    const valid = await bcrypt.compare(dto.password, hashToCheck);

    // Check lockout after bcrypt so timing is equalized regardless of lock state.
    if (credential?.status === CredentialStatus.ACTIVE &&
        credential.lockedUntil && credential.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked. Try again later.');
    }

    if (!credential || credential.status !== CredentialStatus.ACTIVE || !valid) {
      // Only track failures for active credentials — disabled accounts and unknown
      // emails must not influence failure counters (prevents enumeration via lockout).
      if (credential?.status === CredentialStatus.ACTIVE && !valid) {
        await this.recordFailedAttempt(credential);
      }
      throw new UnauthorizedException("Invalid credentials");
    }

    // Credentials are valid — reset the failure counter and any previous lockout.
    await this.clearLoginFailures(credential);

    let userInfo: { isSuperAdmin: boolean };
    let companies: string[];
    try {
      [userInfo, companies] = await Promise.all([
        this.getCachedUserInfo(credential.userId),
        this.getCachedUserCompanies(credential.userId),
      ]);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException("Invalid credentials");
      }
      throw err;
    }

    // Block login for non-super-admin users with no active company memberships.
    // This covers the case where a user's only company was deleted.
    if (!userInfo.isSuperAdmin && companies.length === 0) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.generateTokenPair(credential, {
      isSuperAdmin: userInfo.isSuperAdmin || undefined,
    });
  }

  /**
   * Refresh token rotation.
   * Preserves companyId and recalculates scoped claims from user-service.
   */
  async refresh(refreshToken: string) {
    let payload: RefreshTokenPayload;
    try {
      const kid = this.getTokenKid(refreshToken);
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.jwtKeyService.resolveRefreshSecret(kid),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Consume the token atomically: GETDEL returns the value and deletes the key
    // in a single operation. Concurrent requests with the same token will get
    // null on the second call, preventing replay attacks.
    const consumed = await this.redis.getdel(
      `refresh:${payload.sub}:${payload.jti}`,
    );
    if (!consumed) throw new UnauthorizedException("Refresh token revoked");

    const credential = await this.credentialRepo.findOne({
      where: { userId: payload.sub },
    });
    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("User not found or inactive");
    }

    // Recalculate scope from user-service instead of trusting the old token.
    // This ensures revoked company access or super admin status is enforced
    // on the next refresh rather than persisting for the full 7-day TTL.
    // Cached fallback (60 s) allows refresh to succeed when user-service is briefly unavailable.
    let companies: string[];
    let userInfo: { isSuperAdmin: boolean };
    try {
      [companies, userInfo] = await Promise.all([
        this.getCachedUserCompanies(payload.sub),
        this.getCachedUserInfo(payload.sub),
      ]);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException("Invalid credentials");
      }
      throw err;
    }

    // Block non-super-admin users with no active company memberships.
    if (!userInfo.isSuperAdmin && companies.length === 0) {
      throw new UnauthorizedException("Scope revoked");
    }

    if (payload.companyId && !companies.includes(payload.companyId)) {
      throw new UnauthorizedException("Scope revoked");
    }

    let permissions: string[] | undefined;
    if (payload.companyId) {
      const rawPermissions =
        await this.userClientService.getUserEffectivePermissions(
          credential.userId,
          payload.companyId,
        );
      permissions = rawPermissions.map((p) => `${p.module}:${p.action}`);
    }

    const tokenPair = await this.generateTokenPair(credential, {
      companyId: payload.companyId,
      permissions,
      // Only include isSuperAdmin for global (non-company) tokens.
      // Company-scoped tokens must not carry isSuperAdmin so the user
      // is limited to their company role permissions in that context.
      ...(!payload.companyId && { isSuperAdmin: userInfo.isSuperAdmin || undefined }),
    });

    // Extend the saved global refresh token TTL on every company-scoped refresh
    // so the super-admin can still exit the company after long sessions.
    if (payload.companyId) {
      const globalKey = `sa-global-rt:${credential.userId}`;
      const storedGlobal = await this.redis.get(globalKey);
      if (storedGlobal) {
        const globalPayload = this.jwtService.decode(storedGlobal) as Record<string, unknown> | null;
        await Promise.all([
          this.redis.expire(globalKey, this.refreshTtlSeconds),
          globalPayload?.sub && globalPayload?.jti
            ? this.redis.expire(`refresh:${globalPayload.sub}:${globalPayload.jti}`, this.refreshTtlSeconds)
            : Promise.resolve(),
        ]);
      }
    }

    return tokenPair;
  }

  /**
   * Disables credentials for a user (called when user is soft-deleted in user-service).
   * No-op if no credential exists — user was never provisioned.
   */
  async disableCredential(userId: string): Promise<void> {
    const credential = await this.credentialRepo.findOne({ where: { userId } });
    if (!credential) return;
    credential.status = CredentialStatus.DISABLED;
    await this.credentialRepo.save(credential);
  }

  /**
   * Deletes all refresh tokens for a user from Redis and writes a short-lived
   * revocation marker so the JWT guard can deny super-admin requests immediately,
   * without waiting for the access token to expire.
   * TTL matches JWT_EXPIRATION so the marker auto-cleans once all issued tokens
   * have expired and can no longer be presented.
   */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');

    // Mark the user as super-admin-revoked for the duration of the access-token TTL.
    // The JWT guard reads this key to block super-admin requests even while the
    // existing token is still cryptographically valid.
    const ttlSeconds = parseDurationToSeconds(
      this.configService.get<string>('JWT_EXPIRATION') ?? '300s',
    );
    await this.redis.set(`sa-revoked:${userId}`, '1', 'EX', ttlSeconds);
  }

  /**
   * Re-enables credentials for a user (called when user is restored in user-service).
   * No-op if no credential exists — user was never provisioned.
   */
  async enableCredential(userId: string): Promise<void> {
    const credential = await this.credentialRepo.findOne({ where: { userId } });
    if (!credential) return;
    credential.status = CredentialStatus.ACTIVE;
    await this.credentialRepo.save(credential);
  }

  /**
   * Returns the list of orgIds the user belongs to, ordered by first join (ASC).
   * The first element is treated as the default company by the frontend.
   */
  async getMyCompanies(userId: string): Promise<string[]> {
    return this.userClientService.getUserCompanies(userId);
  }

  /**
   * Verifies the access token signature and expiration.
   * Throws UnauthorizedException if the token is invalid or expired.
   * Used by protected routes as a defense-in-depth layer (Kong already validates,
   * but direct pod access would bypass Kong).
   */
  verifyAccessToken(auth: string): Record<string, any> {
    if (!auth?.startsWith("Bearer "))
      throw new UnauthorizedException("Missing token");
    const token = auth.split(" ")[1];
    try {
      const kid = this.getTokenKid(token);
      return this.jwtService.verify(token, {
        secret: this.jwtKeyService.resolveAccessSecret(kid),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  /**
   * Revokes all sessions for the user that owns the given refresh token.
   * Best-effort: if the token is already expired or malformed, still attempts
   * revocation using the decoded sub claim (no signature verification needed).
   */
  async logout(refreshToken: string): Promise<void> {
    let userId: string | undefined;
    try {
      const kid = this.getTokenKid(refreshToken);
      const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.jwtKeyService.resolveRefreshSecret(kid),
      });
      userId = payload.sub;
    } catch {
      // Token is expired or invalid — try to decode without verification
      // so we can still revoke by userId.
      const decoded = this.jwtService.decode(refreshToken) as RefreshTokenPayload | null;
      userId = decoded?.sub;
    }
    if (userId) {
      await this.revokeAllRefreshTokens(userId);
    }
  }

  /**
   * Persists the global refresh token so exit-company can restore it later.
   * Called by the switch-company endpoint before issuing the company-scoped pair.
   */
  async saveGlobalContext(userId: string, globalRefreshToken: string): Promise<void> {
    await this.redis.set(
      `sa-global-rt:${userId}`,
      globalRefreshToken,
      'EX', this.refreshTtlSeconds,
      'NX',
    );
  }

  /**
   * Restores the super-admin global context from the saved global refresh token.
   * Called by the POST /auth/exit-company endpoint.
   * Validates and consumes the company refresh token, then validates and rotates
   * the saved global refresh token to produce a new global token pair.
   */
  async exitCompanyContext(companyRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: RefreshTokenPayload;
    try {
      const kid = this.getTokenKid(companyRefreshToken);
      payload = this.jwtService.verify<RefreshTokenPayload>(companyRefreshToken, {
        secret: this.jwtKeyService.resolveRefreshSecret(kid),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired company refresh token");
    }

    const consumed = await this.redis.getdel(`refresh:${payload.sub}:${payload.jti}`);
    if (!consumed) throw new UnauthorizedException("Company session revoked");

    const globalRefreshToken = await this.redis.getdel(`sa-global-rt:${payload.sub}`);
    if (!globalRefreshToken) {
      throw new UnauthorizedException("Global session expired — please log in again");
    }

    return this.refresh(globalRefreshToken);
  }

  /**
   * Validates the user belongs to companyId and returns a scoped token pair.
   */
  async switchCompany(userId: string, companyId: string) {
    const companies = await this.userClientService.getUserCompanies(userId);

    if (!companies.includes(companyId)) {
      throw new NotFoundException(
        `User does not belong to company ${companyId}`,
      );
    }

    const credential = await this.credentialRepo.findOne({
      where: { userId },
    });
    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("User not found or inactive");
    }

    // isSuperAdmin is intentionally omitted from company-scoped tokens so the user
    // operates with their company role permissions only, regardless of global
    // super admin status. The global token (stored in sgd-super-admin-token)
    // retains isSuperAdmin for exitCompany() to work correctly.
    const rawPermissions = await this.userClientService.getUserEffectivePermissions(
      credential.userId,
      companyId,
    );
    const permissions = rawPermissions.map((p) => `${p.module}:${p.action}`);

    return this.generateTokenPair(credential, {
      companyId,
      permissions,
    });
  }

  /**
   * Generates a password reset token and emits a Kafka event so the
   * notification-service sends the reset email.
   * Always returns { ok: true } to avoid leaking whether an email exists.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const credential = await this.credentialRepo.findOne({ where: { email } });

    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      // Return silently — do not reveal whether the email is registered.
      return { ok: true };
    }

    const token = randomBytes(32).toString('hex');
    const redisKey = `pwd-reset:${token}`;
    await this.redis.setex(redisKey, RESET_TOKEN_TTL_SECONDS, credential.userId);

    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000).toISOString();

    this.kafkaProducer.emitSafe(TOPICS.PASSWORD_RESET, {
      email,
      resetToken: token,
      expiresAt,
    });

    this.logger.log(`Password reset token issued [${getCorrelationId()}]`);
    return { ok: true };
  }

  /**
   * Validates the reset token and sets the new password.
   * The token is consumed atomically (GETDEL) to prevent reuse.
   */
  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    const redisKey = `pwd-reset:${token}`;
    const userId = await this.redis.getdel(redisKey);

    if (!userId) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const credential = await this.credentialRepo.findOne({ where: { userId } });
    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    credential.passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.credentialRepo.save(credential);

    // Invalidate all existing sessions so the user must log in with the new password.
    await this.revokeAllRefreshTokens(userId);

    this.logger.log(`Password reset completed [${getCorrelationId()}]`);
    return { ok: true };
  }

  /**
   * Returns user info from user-service, caching the result in Redis for
   * USER_DATA_CACHE_TTL_SECONDS. On failure, returns the cached value if
   * available (user-service temporarily unavailable) or rethrows.
   */
  private async getCachedUserInfo(userId: string): Promise<{ isSuperAdmin: boolean }> {
    const key = `user-info-cache:${userId}`;
    const cached = await this.redis.get(key);

    try {
      const result = await this.userClientService.getUserInfo(userId);
      await this.redis.setex(key, USER_DATA_CACHE_TTL_SECONDS, JSON.stringify(result));
      return result;
    } catch (err) {
      if (cached) {
        this.logger.warn(`user-service unavailable — using cached user-info for ${userId}`);
        return JSON.parse(cached) as { isSuperAdmin: boolean };
      }
      throw err;
    }
  }

  /**
   * Returns the user's company list from user-service, caching the result in
   * Redis for USER_DATA_CACHE_TTL_SECONDS. On failure, returns the cached
   * value if available or rethrows.
   */
  private async getCachedUserCompanies(userId: string): Promise<string[]> {
    const key = `user-companies-cache:${userId}`;
    const cached = await this.redis.get(key);

    try {
      const result = await this.userClientService.getUserCompanies(userId);
      await this.redis.setex(key, USER_DATA_CACHE_TTL_SECONDS, JSON.stringify(result));
      return result;
    } catch (err) {
      if (cached) {
        this.logger.warn(`user-service unavailable — using cached user-companies for ${userId}`);
        return JSON.parse(cached) as string[];
      }
      throw err;
    }
  }

  /**
   * Increments the per-email failure counter in Redis and locks the account
   * in the DB when the count reaches a lockout threshold.
   */
  private async recordFailedAttempt(credential: Credential): Promise<void> {
    const key = `login-failures:${credential.email}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, FAILURE_COUNTER_TTL_SECONDS);

    // Pick the most severe applicable lockout stage (reverse-find)
    const stage = LOCKOUT_STAGES.slice().reverse().find(s => count >= s.threshold);
    if (stage) {
      credential.lockedUntil = new Date(Date.now() + stage.durationMs);
      await this.credentialRepo.save(credential);
      this.logger.warn(
        `Account locked: ${credential.email} after ${count} failures (${stage.durationMs / 60000} min)`,
      );
    }
  }

  /**
   * Clears the Redis failure counter and removes any DB lockout after a
   * successful authentication.
   */
  private async clearLoginFailures(credential: Credential): Promise<void> {
    await this.redis.del(`login-failures:${credential.email}`);
    if (credential.lockedUntil) {
      credential.lockedUntil = null;
      await this.credentialRepo.save(credential);
    }
  }

  private getTokenKid(token: string): string | undefined {
    return (this.jwtService.decode(token, { complete: true }) as JwtComplete | null)?.header?.kid;
  }

  private async generateTokenPair(
    credential: Credential,
    options: TokenOptions = {},
  ) {
    const jti = randomUUID();

    const basePayload: Record<string, unknown> = {
      sub: credential.userId,
      email: credential.email,
      iss: "sgd-jwt-key",
    };

    if (options.companyId) basePayload.companyId = options.companyId;
    if (options.isSuperAdmin) basePayload.isSuperAdmin = options.isSuperAdmin;
    if (options.permissions?.length) basePayload.permissions = options.permissions;

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.jwtKeyService.accessSecret,
      expiresIn: this.configService.getOrThrow<StringValue>("JWT_EXPIRATION"),
      keyid: this.jwtKeyService.accessKid,
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.jwtKeyService.refreshSecret,
        expiresIn: this.configService.getOrThrow<StringValue>("JWT_REFRESH_EXPIRATION"),
        keyid: this.jwtKeyService.refreshKid,
      },
    );

    // Fix: use userId (not credential.id) so refresh lookup is consistent
    await this.redis.setex(
      `refresh:${credential.userId}:${jti}`,
      this.refreshTtlSeconds,
      "1",
    );

    return { accessToken, refreshToken };
  }
}
