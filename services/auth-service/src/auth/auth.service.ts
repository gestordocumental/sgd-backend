import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { Credential, CredentialStatus } from "./entities/credential.entity";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { LoginDto } from "./dto/login.dto";
import { UserClientService } from "../user-client/user-client.service";

// Refresh token TTL in Redis (must match JWT_REFRESH_EXPIRATION: 12h)
const REFRESH_TTL_SECONDS = 12 * 60 * 60;

// bcrypt cost factor — read from env so it can be tuned per environment.
// Default 12 gives ~250ms on modern hardware which is OWASP-recommended.
const DEFAULT_BCRYPT_ROUNDS = 12;
const parsedRounds = Number.parseInt(
  process.env['BCRYPT_ROUNDS'] ?? String(DEFAULT_BCRYPT_ROUNDS),
  10,
);
const BCRYPT_ROUNDS =
  Number.isInteger(parsedRounds) && parsedRounds >= 10 && parsedRounds <= 14
    ? parsedRounds
    : DEFAULT_BCRYPT_ROUNDS;

// Dummy hash used when the user is not found — ensures bcrypt.compare always
// runs so response time doesn't reveal whether an email exists in the system.
// Generated at startup with the same cost factor as real hashes to keep timings comparable.
const DUMMY_HASH = bcrypt.hashSync('__invalid_password__', BCRYPT_ROUNDS);

interface TokenOptions {
  companyId?: string;
  isSuperAdmin?: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepo: Repository<Credential>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    private readonly userClientService: UserClientService,
  ) {}

  /**
   * Idempotent: creates credentials by email (global, not per-company).
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
        existing.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
        existing.status = CredentialStatus.ACTIVE;
        await this.credentialRepo.save(existing);
      }

      return { ok: true };
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

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
    // Use DUMMY_HASH when credential is missing, inactive, or has no password yet
    // (invitation flow: user created but complete-registration not done).
    const hashToCheck = (credential?.status === CredentialStatus.ACTIVE && credential.passwordHash)
      ? credential.passwordHash
      : DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCheck);

    if (!credential || credential.status !== CredentialStatus.ACTIVE || !valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    let userInfo: { isSuperAdmin: boolean };
    try {
      userInfo = await this.userClientService.getUserInfo(credential.userId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException("Invalid credentials");
      }
      throw err;
    }

    return this.generateTokenPair(credential, {
      isSuperAdmin: userInfo.isSuperAdmin || undefined,
    });
  }

  /**
   * Refresh token rotation.
   * Preserves companyId and isSuperAdmin from the existing token if present.
   */
  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
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
    let companies: string[] | null;
    let userInfo: { isSuperAdmin: boolean };
    try {
      [companies, userInfo] = await Promise.all([
        payload.companyId
          ? this.userClientService.getUserCompanies(payload.sub)
          : Promise.resolve<string[] | null>(null),
        this.userClientService.getUserInfo(payload.sub),
      ]);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException("Invalid credentials");
      }
      throw err;
    }

    if (payload.companyId && !companies?.includes(payload.companyId)) {
      throw new UnauthorizedException("Scope revoked");
    }

    return this.generateTokenPair(credential, {
      companyId: payload.companyId,
      // Only include isSuperAdmin for global (non-company) tokens.
      // Company-scoped tokens must not carry isSuperAdmin so the user
      // is limited to their company role permissions in that context.
      ...(!payload.companyId && { isSuperAdmin: userInfo.isSuperAdmin || undefined }),
    });
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
      return this.jwtService.verify(token, {
        secret: this.configService.get<string>("JWT_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
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
    return this.generateTokenPair(credential, {
      companyId,
    });
  }

  private async generateTokenPair(
    credential: Credential,
    options: TokenOptions = {},
  ) {
    const jti = randomUUID();

    const basePayload: Record<string, any> = {
      sub: credential.userId,
      email: credential.email,
      iss: "sgd-jwt-key",
    };

    if (options.companyId) basePayload.companyId = options.companyId;
    if (options.isSuperAdmin) basePayload.isSuperAdmin = options.isSuperAdmin;

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get<string>("JWT_SECRET"),
      expiresIn: this.configService.get<string>("JWT_EXPIRATION"),
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: this.configService.get<string>("JWT_REFRESH_EXPIRATION"),
      },
    );

    // Fix: use userId (not credential.id) so refresh lookup is consistent
    await this.redis.setex(
      `refresh:${credential.userId}:${jti}`,
      REFRESH_TTL_SECONDS,
      "1",
    );

    return { accessToken, refreshToken };
  }
}
