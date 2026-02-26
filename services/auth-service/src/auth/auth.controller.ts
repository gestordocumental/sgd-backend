import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

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
  login(@Headers("x-company-id") companyId: string, @Body() dto: LoginDto) {
    if (!companyId) {
      throw new BadRequestException('Missing header x-company-id');
    }
    return this.authService.login(companyId, dto);
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // ── PROTECTED routes (Kong validates JWT before arriving here) ───────────────

  @Get("me")
  async me(@Headers("authorization") auth: string) {
    // Kong has already validated the JWT signature. We decoded it to obtain the sub.
    if (!auth?.startsWith("Bearer ")) throw new UnauthorizedException();

    const token = auth.split(" ")[1];
    const payload: any = this.decodeJwt(token);

     if (!payload?.sub || !payload?.companyId) {
      throw new UnauthorizedException('Invalid token (missing claims)');
    }

    return this.authService.getIdentity(payload.companyId, payload.sub);
  }

  private decodeJwt(jwt: string) {
    try {
      const [, payloadB64] = jwt.split('.');
      const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

}
