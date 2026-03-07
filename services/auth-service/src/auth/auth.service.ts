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

// TTL del refresh token en Redis (debe coincidir con JWT_REFRESH_EXPIRATION: 7d)
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

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
        existing.passwordHash = await bcrypt.hash(dto.password, 10);
        existing.status = CredentialStatus.ACTIVE;
        await this.credentialRepo.save(existing);
      }

      return { ok: true };
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

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

    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const valid = await bcrypt.compare(dto.password, credential.passwordHash);
    if (!valid) throw new UnauthorizedException("Credenciales inválidas");

    const userInfo = await this.userClientService.getUserInfo(credential.userId);

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
      throw new UnauthorizedException("Refresh token inválido o expirado");
    }

    // Verify the token was not revoked in Redis
    const exists = await this.redis.exists(
      `refresh:${payload.sub}:${payload.jti}`,
    );
    if (!exists) throw new UnauthorizedException("Refresh token revocado");

    const credential = await this.credentialRepo.findOne({
      where: { userId: payload.sub },
    });
    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("Usuario no encontrado o inactivo");
    }

    // Rotate: delete used token, issue new pair preserving scope
    await this.redis.del(`refresh:${payload.sub}:${payload.jti}`);

    const options: TokenOptions = {};
    if (payload.companyId) options.companyId = payload.companyId;
    if (payload.isSuperAdmin) options.isSuperAdmin = payload.isSuperAdmin;

    return this.generateTokenPair(credential, options);
  }

  /**
   * Returns the list of orgIds the user belongs to, ordered by first join (ASC).
   * The first element is treated as the default company by the frontend.
   */
  async getMyCompanies(userId: string): Promise<string[]> {
    return this.userClientService.getUserCompanies(userId);
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
      throw new UnauthorizedException("Usuario no encontrado o inactivo");
    }

    return this.generateTokenPair(credential, { companyId });
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
