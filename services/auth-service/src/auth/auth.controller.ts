import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("credentials/provision")
  provisionCredentials(
    @Headers("x-internal-token") internalToken: string,
    @Body() dto: ProvisionCredentialDto,
  ) {
    if (internalToken !== process.env.INTERNAL_TOKEN) {
      throw new UnauthorizedException();
    }
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

  @Get("me")
  async me(@Headers("authorization") auth: string) {
    const payload = this.extractPayload(auth);
    if (!payload?.sub) throw new UnauthorizedException("Invalid token (missing claims)");
    return {
      userId: payload.sub,
      email: payload.email,
      ...(payload.companyId && { companyId: payload.companyId }),
      ...(payload.isSuperAdmin && { isSuperAdmin: payload.isSuperAdmin }),
    };
  }

  @Get("me/companies")
  async getMyCompanies(@Headers("authorization") auth: string) {
    const payload = this.extractPayload(auth);
    if (!payload?.sub) throw new UnauthorizedException("Invalid token");
    return this.authService.getMyCompanies(payload.sub);
  }

  @Post("switch-company")
  async switchCompany(
    @Headers("authorization") auth: string,
    @Body() dto: SwitchCompanyDto,
  ) {
    const payload = this.extractPayload(auth);
    if (!payload?.sub) throw new UnauthorizedException("Invalid token");
    return this.authService.switchCompany(payload.sub, dto.companyId);
  }

  private extractPayload(auth: string) {
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.split(" ")[1];
    try {
      const [, payloadB64] = token.split(".");
      const json = Buffer.from(payloadB64, "base64url").toString("utf8");
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}
