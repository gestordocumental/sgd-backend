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
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiParam,
} from '@nestjs/swagger';

const REFRESH_COOKIE_NAME = 'sgd_refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

@ApiTags('Auth')
@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private validateInternalToken(internalToken: string): void {
    // Only user-service is allowed to call auth-service internal endpoints.
    const rawExpected = this.configService
      .getOrThrow<string>('INTERNAL_TOKEN_USER_AUTH')
      .trim();
    if (!rawExpected) {
      throw new Error('INTERNAL_TOKEN_USER_AUTH must be a non-empty string');
    }
    const expected = Buffer.from(rawExpected);
    const provided = Buffer.from(internalToken ?? '');
    const isValid =
      provided.length === expected.length &&
      timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException();
  }

  private setRefreshCookie(res: Response | undefined, refreshToken: string): void {
    if (!res) return;
    // sameSite: 'none' is required for cross-origin requests (e.g. Vercel frontend → Railway API).
    // SameSite=None mandates Secure=true, which is already enforced in production.
    const isProduction = process.env['NODE_ENV'] === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'strict',
      path: '/api/v1/auth',
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

  @ApiOperation({ summary: 'Revoke all refresh tokens for a user (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'All refresh tokens revoked' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @Patch("credentials/:userId/revoke-tokens")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeAllRefreshTokens(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId") userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.revokeAllRefreshTokens(userId);
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
    // When the body carries an explicit refreshToken, use it unconditionally.
    // This allows exitCompany() on the frontend to restore the global
    // super-admin context by sending the stored global refresh token in the
    // body, even when the httpOnly cookie currently holds a company-scoped
    // token (which would otherwise shadow it).
    // Both paths validate the token via Redis GETDEL + JWT signature, so the
    // security posture is identical.
    let refreshToken: string;
    if (body?.refreshToken) {
      refreshToken = body.refreshToken;
    } else {
      try {
        refreshToken = this.getRefreshTokenFromCookie(cookieHeader);
      } catch (err) {
        if (err instanceof UnauthorizedException && err.message === 'Missing refresh cookie') {
          throw new UnauthorizedException('Missing refresh token');
        }
        throw err;
      }
    }
    return this.toAccessTokenResponse(await this.authService.refresh(refreshToken), res);
  }

  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: 200, description: 'Always returns ok:true to avoid email enumeration' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @UseGuards(ThrottlerGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @ApiOperation({ summary: 'Reset password using the token received by email' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @UseGuards(ThrottlerGuard)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
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
  async switchCompany(
    @Headers("authorization") auth: string,
    @Body() dto: SwitchCompanyDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const payload = this.authService.verifyAccessToken(auth);
    const tokenPair = await this.authService.switchCompany(payload.sub, dto.companyId);
    return this.toAccessTokenResponse(tokenPair, res);
  }
}
