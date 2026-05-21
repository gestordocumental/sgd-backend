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
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiParam,
} from '@nestjs/swagger';

const REFRESH_COOKIE_NAME = 'sgd_refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

  private setRefreshCookie(res: Response | undefined, refreshToken: string): void {
    if (!res) return;
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
    res.setHeader('Cache-Control', 'no-store');
  }

  private getRefreshTokenFromCookie(cookieHeader: string | undefined): string {
    const cookie = cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));

    if (!cookie) throw new UnauthorizedException('Missing refresh cookie');

    const raw = cookie.slice(REFRESH_COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      throw new UnauthorizedException('Malformed refresh cookie');
    }
  }

  private toAccessTokenResponse(
    tokenPair: { accessToken: string; refreshToken: string },
    res: Response | undefined,
  ): { accessToken: string; refreshToken: string } {
    this.setRefreshCookie(res, tokenPair.refreshToken);
    // Return the refresh token in the body so cross-origin clients (no withCredentials)
    // can store it themselves. The httpOnly cookie remains as defense-in-depth.
    return { accessToken: tokenPair.accessToken, refreshToken: tokenPair.refreshToken };
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
  @ApiResponse({ status: 200, description: 'Returns accessToken and sets refresh token as HttpOnly cookie' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @UseGuards(ThrottlerGuard)
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    return this.toAccessTokenResponse(await this.authService.login(dto), res);
  }

  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Returns new accessToken + refreshToken and rotates refresh HttpOnly cookie' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @UseGuards(ThrottlerGuard)
  @Post("refresh")
  async refresh(
    @Headers("cookie") cookieHeader: string | undefined,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res?: Response,
  ) {
    // Prefer the httpOnly cookie (more secure); fall back to the body token for
    // cross-origin clients that cannot send cookies without withCredentials.
    let refreshToken: string;
    try {
      refreshToken = this.getRefreshTokenFromCookie(cookieHeader);
    } catch {
      if (!body?.refreshToken) {
        throw new UnauthorizedException('Missing refresh token');
      }
      refreshToken = body.refreshToken;
    }
    return this.toAccessTokenResponse(await this.authService.refresh(refreshToken), res);
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
  @ApiResponse({ status: 200, description: 'Returns new accessToken with updated companyId and rotates refresh cookie' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @Post("switch-company")
  switchCompany(
    @Headers("authorization") auth: string,
    @Body() dto: SwitchCompanyDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const payload = this.authService.verifyAccessToken(auth);
    return this.authService
      .switchCompany(payload.sub, dto.companyId)
      .then((tokenPair) => this.toAccessTokenResponse(tokenPair, res));
  }
}
