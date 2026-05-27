import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// The internal token used across all internal-endpoint tests
const INTERNAL_TOKEN = 'my-super-secret-internal-token';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let configService: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    authService = {
      provisionCredentials: jest.fn().mockResolvedValue({ ok: true }),
      disableCredential: jest.fn().mockResolvedValue(undefined),
      enableCredential: jest.fn().mockResolvedValue(undefined),
      revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
      login: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
      forgotPassword: jest.fn().mockResolvedValue({ ok: true }),
      resetPassword: jest.fn().mockResolvedValue({ ok: true }),
      getMyCompanies: jest.fn().mockResolvedValue(['org-id']),
      switchCompany: jest.fn().mockResolvedValue({ accessToken: 'scoped.jwt', refreshToken: 'refresh.jwt' }),
      verifyAccessToken: jest.fn().mockReturnValue({ sub: 'user-id', email: 'user@test.com' }),
    };

    configService = {
      getOrThrow: jest.fn().mockReturnValue(INTERNAL_TOKEN),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── provisionCredentials ──────────────────────────────────────────────────

  describe('POST /api/v1/auth/credentials/provision', () => {
    const dto = { userId: 'user-id', email: 'user@test.com', password: 'pass1234' };

    it('provisions credentials when internal token is valid', async () => {
      const result = await controller.provisionCredentials(INTERNAL_TOKEN, dto);

      expect(authService.provisionCredentials).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ ok: true });
    });

    it('throws UnauthorizedException when internal token is wrong', () => {
      // validateInternalToken throws synchronously — use toThrow, not rejects.toThrow
      expect(() => controller.provisionCredentials('wrong-token', dto))
        .toThrow(UnauthorizedException);

      expect(authService.provisionCredentials).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when internal token is missing (empty string)', () => {
      expect(() => controller.provisionCredentials('', dto))
        .toThrow(UnauthorizedException);
    });

    it('throws when the expected internal token is blank', () => {
      configService.getOrThrow.mockReturnValue('   ');

      expect(() => controller.provisionCredentials('', dto))
        .toThrow('INTERNAL_TOKEN_USER_AUTH must be a non-empty string');
      expect(authService.provisionCredentials).not.toHaveBeenCalled();
    });
  });

  // ── disableCredential ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/auth/credentials/:userId/disable', () => {
    it('disables credential when internal token is valid', async () => {
      await controller.disableCredential(INTERNAL_TOKEN, 'user-id');

      expect(authService.disableCredential).toHaveBeenCalledWith('user-id');
    });

    it('throws UnauthorizedException when internal token is invalid', () => {
      expect(() => controller.disableCredential('bad-token', 'user-id'))
        .toThrow(UnauthorizedException);

      expect(authService.disableCredential).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/v1/auth/credentials/:userId/revoke-tokens', () => {
    it('revokes all refresh tokens when internal token is valid', async () => {
      await controller.revokeAllRefreshTokens(INTERNAL_TOKEN, 'user-id');

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith('user-id');
    });

    it('throws UnauthorizedException when internal token is invalid', () => {
      expect(() => controller.revokeAllRefreshTokens('bad-token', 'user-id'))
        .toThrow(UnauthorizedException);

      expect(authService.revokeAllRefreshTokens).not.toHaveBeenCalled();
    });
  });

  // ── enableCredential ──────────────────────────────────────────────────────

  describe('PATCH /api/v1/auth/credentials/:userId/enable', () => {
    it('enables credential when internal token is valid', async () => {
      await controller.enableCredential(INTERNAL_TOKEN, 'user-id');

      expect(authService.enableCredential).toHaveBeenCalledWith('user-id');
    });

    it('throws UnauthorizedException when internal token is invalid', () => {
      expect(() => controller.enableCredential('bad-token', 'user-id'))
        .toThrow(UnauthorizedException);

      expect(authService.enableCredential).not.toHaveBeenCalled();
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('delegates to authService.login and returns token pair', async () => {
      const dto = { email: 'user@test.com', password: 'pass1234' };

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('sets refresh token cookie when response is provided', async () => {
      const dto = { email: 'user@test.com', password: 'pass1234' };
      const res = { cookie: jest.fn(), setHeader: jest.fn() };
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const result = await controller.login(dto, res as any);

      expect(result).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
      expect(res.cookie).toHaveBeenCalledWith(
        'sgd_refresh_token',
        'refresh.jwt',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          path: '/api/v1/auth',
        }),
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('delegates to authService.refresh and returns new token pair', async () => {
      const result = await controller.refresh(undefined, { refreshToken: 'old.refresh.jwt' });

      expect(authService.refresh).toHaveBeenCalledWith('old.refresh.jwt');
      expect(result).toHaveProperty('accessToken');
    });

    it('prefers refresh token from cookie over request body', async () => {
      const res = { cookie: jest.fn(), setHeader: jest.fn() };

      const result = await controller.refresh(
        'other=value; sgd_refresh_token=cookie.refresh.jwt',
        { refreshToken: 'body.refresh.jwt' },
        res as any,
      );

      expect(authService.refresh).toHaveBeenCalledWith('cookie.refresh.jwt');
      expect(result).toHaveProperty('refreshToken', 'refresh.jwt');
      expect(res.cookie).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when refresh token is missing from cookie and body', async () => {
      await expect(controller.refresh(undefined, {})).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when refresh cookie is malformed', async () => {
      await expect(
        controller.refresh('sgd_refresh_token=%E0%A4%A', { refreshToken: 'body.refresh.jwt' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('delegates forgot-password by email', async () => {
      await expect(controller.forgotPassword({ email: 'user@test.com' })).resolves.toEqual({ ok: true });

      expect(authService.forgotPassword).toHaveBeenCalledWith('user@test.com');
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('delegates reset-password with token and new password', async () => {
      await expect(
        controller.resetPassword({ token: 'reset-token', newPassword: 'new-password' }),
      ).resolves.toEqual({ ok: true });

      expect(authService.resetPassword).toHaveBeenCalledWith('reset-token', 'new-password');
    });
  });

  // ── me ────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/me', () => {
    it('returns user info from valid access token', () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id', email: 'user@test.com' });

      const result = controller.me('Bearer valid.token');

      expect(result).toMatchObject({ userId: 'user-id', email: 'user@test.com' });
    });

    it('includes companyId when present in token payload', () => {
      authService.verifyAccessToken.mockReturnValue({
        sub: 'user-id',
        email: 'user@test.com',
        companyId: 'org-id',
      });

      const result = controller.me('Bearer scoped.token');

      expect(result).toHaveProperty('companyId', 'org-id');
    });

    it('includes isSuperAdmin when present in token payload', () => {
      authService.verifyAccessToken.mockReturnValue({
        sub: 'user-id',
        email: 'user@test.com',
        isSuperAdmin: true,
      });

      const result = controller.me('Bearer admin.token');

      expect(result).toHaveProperty('isSuperAdmin', true);
    });

    it('throws UnauthorizedException when token payload has no sub claim', () => {
      authService.verifyAccessToken.mockReturnValue({ email: 'user@test.com' }); // no sub

      expect(() => controller.me('Bearer no-sub.token')).toThrow(UnauthorizedException);
    });
  });

  // ── getMyCompanies ────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/me/companies', () => {
    it('returns list of companies for the authenticated user', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      const result = await controller.getMyCompanies('Bearer valid.token');

      expect(authService.getMyCompanies).toHaveBeenCalledWith('user-id');
      expect(result).toEqual(['org-id']);
    });
  });

  // ── switchCompany ─────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/switch-company', () => {
    it('returns scoped token pair for a valid company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      const result = await controller.switchCompany('Bearer valid.token', { companyId: 'org-id' });

      expect(authService.switchCompany).toHaveBeenCalledWith('user-id', 'org-id');
      expect(result).toHaveProperty('accessToken');
    });

    it('sets refresh cookie for scoped token response', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });
      const res = { cookie: jest.fn(), setHeader: jest.fn() };

      const result = await controller.switchCompany(
        'Bearer valid.token',
        { companyId: 'org-id' },
        res as any,
      );

      expect(result).toEqual({ accessToken: 'scoped.jwt', refreshToken: 'refresh.jwt' });
      expect(res.cookie).toHaveBeenCalledWith(
        'sgd_refresh_token',
        'refresh.jwt',
        expect.any(Object),
      );
    });

    it('propagates NotFoundException when user does not belong to company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });
      authService.switchCompany.mockRejectedValue(new NotFoundException('User does not belong to company'));

      await expect(
        controller.switchCompany('Bearer valid.token', { companyId: 'org-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
