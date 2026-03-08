import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post("credentials/provision")
  provisionCredentials(
    @Headers("x-internal-token") internalToken: string,
    @Body() dto: ProvisionCredentialDto,
  ) {
    const expected = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const isValid =
      internalToken?.length === expected.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(internalToken));
    if (!isValid) throw new UnauthorizedException();
    return this.authService.provisionCredentials(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // ── PROTECTED routes (Kong validates JWT before arriving here) ───────────────
  // verifyAccessToken() re-validates signature as a defense-in-depth measure
  // in case the pod is reached directly (port-forward, alternative ingress, etc.)

  @Get("me")
  me(@Headers("authorization") auth: string) {
    const payload = this.authService.verifyAccessToken(auth);
    if (!payload.sub) throw new UnauthorizedException("Invalid token (missing claims)");
    return {
      userId: payload.sub,
      email: payload.email,
      ...(payload.companyId && { companyId: payload.companyId }),
      ...(payload.isSuperAdmin && { isSuperAdmin: payload.isSuperAdmin }),
    };
  }

  @Get("me/companies")
  getMyCompanies(@Headers("authorization") auth: string) {
    const payload = this.authService.verifyAccessToken(auth);
    return this.authService.getMyCompanies(payload.sub);
  }

  @Post("switch-company")
  switchCompany(
    @Headers("authorization") auth: string,
    @Body() dto: SwitchCompanyDto,
  ) {
    const payload = this.authService.verifyAccessToken(auth);
    return this.authService.switchCompany(payload.sub, dto.companyId);
  }
}
