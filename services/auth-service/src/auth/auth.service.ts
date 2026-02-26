import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  ForbiddenException,
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

// TTL del refresh token en Redis (debe coincidir con JWT_REFRESH_EXPIRATION: 7d)
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepo: Repository<Credential>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
  ) {}

  /**
   * It is called when the user completed the invitation in User Service.
   * Creates credentials (or is idempotent if they already exist) for (companyId, email).
   */
  async provisionCredentials(dto: ProvisionCredentialDto) {
    // Idempotence by (companyId, email)
    const existing = await this.credentialRepo.findOne({
      where: { companyId: dto.companyId, email: dto.email },
    });

    if (existing) {
      if (existing.userId !== dto.userId) {
        throw new ConflictException(
          "Email already registered for another account with this company",
        );
      }
      if (existing.status === CredentialStatus.DISABLED) {
        throw new ForbiddenException("Credentials disabled");
      }

      // If it exists, but doesn't have a passwordHash (rare case), you set it.
      if (!existing.passwordHash) {
        existing.passwordHash = await bcrypt.hash(dto.password, 10);
        existing.status = CredentialStatus.ACTIVE;
        await this.credentialRepo.save(existing);
      }

      return{ok : true}
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const credential = this.credentialRepo.create({
      companyId: dto.companyId,
      userId: dto.userId,
      email: dto.email,
      passwordHash,
      status: CredentialStatus.ACTIVE,
    });

    await this.credentialRepo.save(credential);
    return { ok: true };
  }

  /**
   * Login requiere companyId porque email es único por empresa.
   * companyId idealmente viene por header/subdominio, no en el body.
   */
  async login(companyId: string, dto: LoginDto) {
    const credential = await this.credentialRepo.findOne({
      where: { companyId, email: dto.email },
    });

    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const valid = await bcrypt.compare(dto.password, credential.passwordHash);
    if (!valid) throw new UnauthorizedException("Credenciales inválidas");

    return this.generateTokenPair(credential);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Refresh token inválido o expirado");
    }

    // Verificar que el token no fue revocado en Redis
    const exists = await this.redis.exists(
      `refresh:${payload.sub}:${payload.jti}`,
    );
    if (!exists) throw new UnauthorizedException('Refresh token revocado');

    const credential = await this.credentialRepo.findOne({
      where: { companyId: payload.companyId, userId: payload.sub },
    });
    if (!credential || credential.status !== CredentialStatus.ACTIVE) {
      throw new UnauthorizedException("Usuario no encontrado o inactivo");
    }

    // Rotación: eliminar token usado, emitir nuevo par
    await this.redis.del(`refresh:${payload.sub}:${payload.jti}`);
    return this.generateTokenPair(credential);
  }

  async getIdentity(companyId: string, userId: string) {
    const credential = await this.credentialRepo.findOne({
      where: { companyId, userId },
    });
    if (!credential) throw new UnauthorizedException('Usuario no encontrado');

    return {
      userId: credential.userId,
      email: credential.email,
      status: credential.status,
      companyId: credential.companyId,
    };
  }

  private async generateTokenPair(credential: Credential) {
    const jti = randomUUID();

    // sub = userId (identidad global del ecosistema)
    const basePayload = {
      sub: credential.userId,
      email: credential.email,
      companyId: credential.companyId,
      iss: 'sgd-jwt-key',
    };

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION'),
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION'),
      },
    );

    // Guardar jti en Redis para poder revocar el refresh token
    await this.redis.setex(
      `refresh:${credential.id}:${jti}`,
      REFRESH_TTL_SECONDS,
      "1",
    );

    return { accessToken, refreshToken };
  }
}
