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
  ParseUUIDPipe,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual, randomUUID } from "crypto";
import { SkipThrottle } from '@nestjs/throttler';
import { Auth, JwtPayload, JwtPayloadParam } from '@sgd/common';
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ProvisionCredentialDto } from "./dto/provision-credentials.dto";
import { SwitchCompanyDto } from "./dto/switch-company.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiSecurity, ApiParam, ApiHeader,
} from '@nestjs/swagger';

const REFRESH_COOKIE_NAME = 'sgd_refresh_token';
const CSRF_COOKIE_NAME = 'sgd_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
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

  private setRefreshCookie(res: Response | undefined, refreshToken: string): string {
    const csrfToken = randomUUID();
    if (!res) return csrfToken;
    // sameSite: 'none' is required for cross-origin requests (e.g. Vercel frontend → Railway API).
    // SameSite=None mandates Secure=true, which is already enforced in production.
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const cookieOptions = {
      secure:   isProduction,
      sameSite: (isProduction ? 'none' : 'strict') as 'none' | 'strict',
      path:     '/api/v1/auth',
      maxAge:   REFRESH_COOKIE_MAX_AGE_MS,
    };

    // httpOnly — inaccessible to JavaScript, prevents XSS token theft.
    // Path restricted to /api/v1/auth so the browser only sends it on auth endpoints.
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...cookieOptions, httpOnly: true });

    // Double Submit Cookie: non-httpOnly companion so frontend JS can read and echo it
    // back as X-CSRF-Token header. Cross-origin scripts cannot read cookies from a
    // different domain, so only same-origin code can construct the correct header value.
    // Path='/' is intentional: the token is a random UUID with no authority on its own,
    // and a root path lets document.cookie read it from any page (e.g. /dashboard).
    res.cookie(CSRF_COOKIE_NAME, csrfToken, { ...cookieOptions, path: '/', httpOnly: false });

    res.setHeader('Cache-Control', 'no-store');
    return csrfToken;
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

  private validateCsrfToken(cookieHeader: string | undefined, csrfHeader: string | undefined): void {
    if (!csrfHeader) throw new UnauthorizedException('Missing CSRF token');

    // Collect ALL sgd_csrf_token cookies — there may be more than one during the
    // path-migration period (old path=/api/v1/auth alongside the new path=/).
    // Browsers send more-specific paths first (RFC 6265 §5.4), so the old stale
    // cookie arrives before the current one. We validate against ANY of them so
    // the transition works without forcing every user to clear cookies manually.
    const candidates = (cookieHeader ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.startsWith(`${CSRF_COOKIE_NAME}=`));

    if (candidates.length === 0) throw new UnauthorizedException('Missing CSRF cookie');

    const provided = Buffer.from(csrfHeader);
    const anyMatch = candidates.some((c) => {
      try {
        const val = decodeURIComponent(c.slice(CSRF_COOKIE_NAME.length + 1));
        const expected = Buffer.from(val);
        return (
          expected.length > 0 &&
          expected.length === provided.length &&
          timingSafeEqual(expected, provided)
        );
      } catch {
        return false;
      }
    });

    if (!anyMatch) throw new UnauthorizedException('Invalid CSRF token');
  }

  /** The refresh token is never returned in the response body — it lives
   *  exclusively in the httpOnly cookie to prevent XSS token theft.
   *  The CSRF token IS returned in the body so the frontend can cache it
   *  in sessionStorage and send it as x-csrf-token on auth requests. */
  private toAccessTokenResponse(
    tokenPair: { accessToken: string; refreshToken: string },
    res: Response | undefined,
  ): { accessToken: string; csrfToken: string } {
    const csrfToken = this.setRefreshCookie(res, tokenPair.refreshToken);
    return { accessToken: tokenPair.accessToken, csrfToken };
  }

  @ApiOperation({ summary: 'Provision credentials for a new user (internal only)' })
  @ApiSecurity('internal-token')
  @ApiBody({ type: ProvisionCredentialDto })
  @ApiResponse({ status: 201, description: 'Credentials provisioned successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @ApiResponse({ status: 409, description: 'Email already registered for another account' })
  @SkipThrottle()
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
  @SkipThrottle()
  @Patch("credentials/:userId/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  disableCredential(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId", new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.disableCredential(userId);
  }

  @ApiOperation({ summary: 'Revoke all refresh tokens for a user (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'All refresh tokens revoked' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @SkipThrottle()
  @Patch("credentials/:userId/revoke-tokens")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeAllRefreshTokens(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId", new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.revokeAllRefreshTokens(userId);
  }

  @ApiOperation({ summary: 'Enable user credentials (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Credentials enabled' })
  @ApiResponse({ status: 401, description: 'Invalid internal token' })
  @SkipThrottle()
  @Patch("credentials/:userId/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  enableCredential(
    @Headers("x-internal-token") internalToken: string,
    @Param("userId", new ParseUUIDPipe({ version: '4' })) userId: string,
  ) {
    this.validateInternalToken(internalToken);
    return this.authService.enableCredential(userId);
  }

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Returns { accessToken, csrfToken } and sets httpOnly refresh cookie' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid email or missing fields' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    return this.toAccessTokenResponse(await this.authService.login(dto), res);
  }

  @ApiOperation({ summary: 'Refresh access token using the httpOnly refresh-token cookie' })
  @ApiHeader({ name: CSRF_HEADER_NAME, required: true, description: 'Must echo the sgd_csrf_token cookie value (double-submit CSRF pattern)' })
  @ApiResponse({ status: 200, description: 'Returns { accessToken, csrfToken } and rotates the httpOnly refresh cookie' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired refresh cookie or CSRF token' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @Post("refresh")
  async refresh(
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers(CSRF_HEADER_NAME) csrfHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    this.validateCsrfToken(cookieHeader, csrfHeader);
    let refreshToken: string;
    try {
      refreshToken = this.getRefreshTokenFromCookie(cookieHeader);
    } catch (err) {
      if (err instanceof UnauthorizedException && err.message === 'Missing refresh cookie') {
        throw new UnauthorizedException('Missing refresh token');
      }
      throw err;
    }
    return this.toAccessTokenResponse(await this.authService.refresh(refreshToken), res);
  }

  @ApiOperation({ summary: 'Logout: revoke all sessions and clear auth cookies' })
  @ApiHeader({ name: CSRF_HEADER_NAME, required: true, description: 'Must echo the sgd_csrf_token cookie value' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Missing or invalid CSRF token' })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers(CSRF_HEADER_NAME) csrfHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<void> {
    this.validateCsrfToken(cookieHeader, csrfHeader);

    try {
      const refreshToken = this.getRefreshTokenFromCookie(cookieHeader);
      await this.authService.logout(refreshToken);
    } catch (err) {
      if (!(err instanceof UnauthorizedException)) {
        throw err;
      }
      // Best effort solo para token/cookie ausente o inválido.
    }

    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const base = {
      secure: isProduction,
      sameSite: (isProduction ? 'none' : 'strict') as 'none' | 'strict',
      maxAge: 0,
    };
    res?.clearCookie(REFRESH_COOKIE_NAME, { ...base, path: '/api/v1/auth', httpOnly: true });
    res?.clearCookie(CSRF_COOKIE_NAME, { ...base, path: '/', httpOnly: false });
  }

  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Always returns ok:true to avoid email enumeration' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid email format' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @ApiOperation({ summary: 'Reset password using the token received by email' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 429, description: 'Too many requests — wait 60 seconds' })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ── PROTECTED routes (Kong validates JWT before arriving here) ───────────────
  // @Auth() activates JwtGuard which re-validates the signature as a defense-in-depth
  // measure in case the pod is reached directly (port-forward, alternative ingress, etc.)

  @ApiOperation({ summary: 'Get current authenticated user info' })
  @ApiBearerAuth('JWT')
  @ApiResponse({ status: 200, description: 'Returns userId, email, companyId and isSuperAdmin' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @Auth()
  @Get("me")
  me(@JwtPayloadParam() payload: JwtPayload) {
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
  @Auth()
  @Get("me/companies")
  getMyCompanies(@JwtPayloadParam() payload: JwtPayload) {
    return this.authService.getMyCompanies(payload.sub);
  }

  @ApiOperation({ summary: 'Switch active company context (generates a new token with selected companyId)' })
  @ApiBearerAuth('JWT')
  @ApiBody({ type: SwitchCompanyDto })
  @ApiResponse({ status: 200, description: 'Returns { accessToken, csrfToken } with updated companyId and rotates httpOnly refresh cookie' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid companyId format' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'User does not belong to the requested company' })
  @Post("switch-company")
  async switchCompany(
    @Headers("authorization") auth: string,
    @Headers("cookie") cookieHeader: string | undefined,
    @Body() dto: SwitchCompanyDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const payload = this.authService.verifyAccessToken(auth);

    // Persist the current global refresh token so exit-company can restore it.
    // Best-effort: if the cookie is absent (non-cookie clients), skip silently.
    try {
      const globalRefreshToken = this.getRefreshTokenFromCookie(cookieHeader);
      await this.authService.saveGlobalContext(payload.sub, globalRefreshToken);
    } catch {
      // Non-httpOnly-cookie clients cannot use exit-company — that is acceptable.
    }

    const tokenPair = await this.authService.switchCompany(payload.sub, dto.companyId);
    return this.toAccessTokenResponse(tokenPair, res);
  }

  @ApiOperation({ summary: 'Restore the global super-admin context after exiting a company' })
  @ApiHeader({ name: CSRF_HEADER_NAME, required: true, description: 'Must echo the sgd_csrf_token cookie value (double-submit CSRF pattern)' })
  @ApiResponse({ status: 200, description: 'Returns { accessToken, csrfToken } for the global context and rotates the httpOnly refresh cookie' })
  @ApiResponse({ status: 401, description: 'Missing cookie, CSRF token, or global session expired — re-login required' })
  @Post("exit-company")
  @HttpCode(HttpStatus.OK)
  async exitCompany(
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers(CSRF_HEADER_NAME) csrfHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    this.validateCsrfToken(cookieHeader, csrfHeader);
    let companyRefreshToken: string;
    try {
      companyRefreshToken = this.getRefreshTokenFromCookie(cookieHeader);
    } catch {
      throw new UnauthorizedException('Missing or malformed refresh cookie');
    }
    return this.toAccessTokenResponse(
      await this.authService.exitCompanyContext(companyRefreshToken),
      res,
    );
  }
}
