import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiParam,
} from '@nestjs/swagger';

@ApiTags('Auth')
@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private validateInternalToken(internalToken: string): void {
    const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
    const provided = Buffer.from(internalToken ?? '');
    const isValid =
      provided.length === expected.length &&
      timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException();
  }

  @ApiOperation({ summary: 'Provision credentials for a new user (internal only)' })
  @ApiSecurity('internal-token')
  @ApiResponse({ status: 201, description: 'Credentials provisioned successfully' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @Post("credentials/provision")
  provisionCredentials(
    @Headers("x-internal-token") internalToken: string,
    @Body() dto: ProvisionCredentialDto,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.provisionCredentials(dto);
  }

  @ApiOperation({ summary: 'Disable user credentials (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Credentials disabled' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @Patch("credentials/:userId/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  disableCredential(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId") userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.disableCredential(userId);
  }

  @ApiOperation({ summary: 'Enable user credentials (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Credentials enabled' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @Patch("credentials/:userId/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  enableCredential(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId") userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.enableCredential(userId);
  }

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns accessToken and refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Returns new accessToken and refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // ── PROTECTED routes (Kong validates JWT before arriving here) ───────────────
  // verifyAccessToken() re-validates signature as a defense-in-depth measure
  // in case the pod is reached directly (port-forward, alternative ingress, etc.)

  @ApiOperation({ summary: 'Get current authenticated user info' })
  @ApiBearerAuth('JWT')
  @ApiResponse({ status: 200, description: 'Returns userId, email, companyId and isSuperAdmin' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
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

  @ApiOperation({ summary: 'Get list of companies the current user belongs to' })
  @ApiBearerAuth('JWT')
  @ApiResponse({ status: 200, description: 'Returns array of companies' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @Get("me/companies")
  getMyCompanies(@Headers("authorization") auth: string) {
    const payload = this.authService.verifyAccessToken(auth);
    return this.authService.getMyCompanies(payload.sub);
  }

  @ApiOperation({ summary: 'Switch active company context (generates a new token with selected companyId)' })
  @ApiBearerAuth('JWT')
  @ApiResponse({ status: 200, description: 'Returns new accessToken with updated companyId' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @Post("switch-company")
  switchCompany(
    @Headers("authorization") auth: string,
    @Body() dto: SwitchCompanyDto,
  ) {
    const payload = this.authService.verifyAccessToken(auth);
    return this.authService.switchCompany(payload.sub, dto.companyId);
  }
}
