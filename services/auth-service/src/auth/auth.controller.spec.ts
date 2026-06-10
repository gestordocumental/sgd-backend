import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { InternalGuard } from '@sgd/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// The internal token used across all internal-endpoint tests
const INTERNAL_TOKEN = 'my-super-secret-internal-token';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };

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
      saveGlobalContext: jest.fn().mockResolvedValue(undefined),
      exitCompanyContext: jest.fn().mockResolvedValue({ accessToken: 'global.jwt', refreshToken: 'global-refresh.jwt' }),
      verifyAccessToken: jest.fn().mockReturnValue({ sub: 'user-id', email: 'user@test.com' }),
    };

    configService = {
      getOrThrow: jest.fn().mockReturnValue(INTERNAL_TOKEN),
      get: jest.fn().mockImplementation((key: string) =>
        key === 'NODE_ENV' ? process.env['NODE_ENV'] : undefined,
      ),
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
      .overrideGuard(InternalGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── provisionCredentials ──────────────────────────────────────────────────
  // Token validation is handled by InternalGuard (overridden in tests).

  describe('POST /api/v1/auth/credentials/provision', () => {
    const dto = { userId: 'user-id', email: 'user@test.com', password: 'pass1234' };

    it('provisions credentials and delegates to authService', async () => {
      const result = await controller.provisionCredentials(dto);

      expect(authService.provisionCredentials).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ ok: true });
    });
  });

  // ── disableCredential ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/auth/credentials/:userId/disable', () => {
    it('disables credential and delegates to authService', async () => {
      await controller.disableCredential('user-id');

      expect(authService.disableCredential).toHaveBeenCalledWith('user-id');
    });
  });

  describe('PATCH /api/v1/auth/credentials/:userId/revoke-tokens', () => {
    it('revokes all refresh tokens and delegates to authService', async () => {
      await controller.revokeAllRefreshTokens('user-id');

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith('user-id');
    });
  });

  // ── enableCredential ──────────────────────────────────────────────────────

  describe('PATCH /api/v1/auth/credentials/:userId/enable', () => {
    it('enables credential and delegates to authService', async () => {
      await controller.enableCredential('user-id');

      expect(authService.enableCredential).toHaveBeenCalledWith('user-id');
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('delegates to authService.login and returns only the access token in the body', async () => {
      const dto = { email: 'user@test.com', password: 'pass1234' };

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toHaveProperty('accessToken');
      // refreshToken must NOT appear in the body — it lives in the httpOnly cookie only
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('sets refresh token cookie and returns accessToken + csrfToken in body', async () => {
      const dto = { email: 'user@test.com', password: 'pass1234' };
      const res = { cookie: jest.fn(), setHeader: jest.fn() };
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const result = await controller.login(dto, res as any);

        expect(result).toMatchObject({ accessToken: 'access.jwt', csrfToken: expect.any(String) });
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
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('reads refresh token from cookie and delegates to authService.refresh', async () => {
      const result = await controller.refresh('sgd_refresh_token=old.refresh.jwt; sgd_csrf_token=test-csrf', 'test-csrf');

      expect(authService.refresh).toHaveBeenCalledWith('old.refresh.jwt');
      expect(result).toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('sets refresh token cookie when response is provided', async () => {
      const res = { cookie: jest.fn(), setHeader: jest.fn() };

      const result = await controller.refresh('sgd_refresh_token=old.refresh.jwt; sgd_csrf_token=test-csrf', 'test-csrf', res as any);

      expect(authService.refresh).toHaveBeenCalledWith('old.refresh.jwt');
      expect(result).toMatchObject({ accessToken: 'access.jwt', csrfToken: expect.any(String) });
      expect(res.cookie).toHaveBeenCalledWith(
        'sgd_refresh_token',
        'refresh.jwt',
        expect.any(Object),
      );
    });

    it('throws UnauthorizedException when no refresh cookie is present', async () => {
      await expect(controller.refresh(undefined, undefined)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when CSRF header is absent but cookie is present', async () => {
      await expect(
        controller.refresh('sgd_refresh_token=old.refresh.jwt; sgd_csrf_token=test-csrf', undefined),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when CSRF header does not match the cookie', async () => {
      await expect(
        controller.refresh('sgd_refresh_token=old.refresh.jwt; sgd_csrf_token=test-csrf', 'wrong-csrf'),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when refresh cookie is malformed (invalid URI encoding)', async () => {
      await expect(
        controller.refresh('sgd_refresh_token=%E0%A4%A; sgd_csrf_token=test-csrf', 'test-csrf'),
      ).rejects.toThrow(UnauthorizedException);

      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('URL-decodes the refresh token value from the cookie before passing to the service', async () => {
      const encoded = encodeURIComponent('valid.refresh.jwt');
      await controller.refresh(`sgd_refresh_token=${encoded}; sgd_csrf_token=test-csrf`, 'test-csrf');

      expect(authService.refresh).toHaveBeenCalledWith('valid.refresh.jwt');
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
      const result = controller.me({ sub: 'user-id', email: 'user@test.com' });

      expect(result).toMatchObject({ userId: 'user-id', email: 'user@test.com' });
    });

    it('includes companyId when present in token payload', () => {
      const result = controller.me({ sub: 'user-id', email: 'user@test.com', companyId: 'org-id' });

      expect(result).toHaveProperty('companyId', 'org-id');
    });

    it('includes isSuperAdmin when present in token payload', () => {
      const result = controller.me({ sub: 'user-id', email: 'user@test.com', isSuperAdmin: true });

      expect(result).toHaveProperty('isSuperAdmin', true);
    });
  });

  // ── getMyCompanies ────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/me/companies', () => {
    it('returns list of companies for the authenticated user', async () => {
      const result = await controller.getMyCompanies({ sub: 'user-id' });

      expect(authService.getMyCompanies).toHaveBeenCalledWith('user-id');
      expect(result).toEqual(['org-id']);
    });
  });

  // ── switchCompany ─────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/switch-company', () => {
    it('returns scoped access token (no refreshToken in body) for a valid company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      const result = await controller.switchCompany(
        'Bearer valid.token',
        undefined,
        { companyId: 'org-id' },
      );

      expect(authService.switchCompany).toHaveBeenCalledWith('user-id', 'org-id');
      expect(result).toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('persists global context and sets refresh cookie when switching company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });
      const res = { cookie: jest.fn(), setHeader: jest.fn() };

      const result = await controller.switchCompany(
        'Bearer valid.token',
        'sgd_refresh_token=global.refresh.jwt',
        { companyId: 'org-id' },
        res as any,
      );

      expect(authService.saveGlobalContext).toHaveBeenCalledWith('user-id', 'global.refresh.jwt');
      expect(result).toMatchObject({ accessToken: 'scoped.jwt', csrfToken: expect.any(String) });
      expect(res.cookie).toHaveBeenCalledWith(
        'sgd_refresh_token',
        'refresh.jwt',
        expect.any(Object),
      );
    });

    it('skips saveGlobalContext silently when no cookie is present', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      await controller.switchCompany(
        'Bearer valid.token',
        undefined,
        { companyId: 'org-id' },
      );

      // saveGlobalContext must not be called when no cookie is available
      expect(authService.saveGlobalContext).not.toHaveBeenCalled();
      expect(authService.switchCompany).toHaveBeenCalledWith('user-id', 'org-id');
    });

    it('propagates NotFoundException when user does not belong to company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });
      authService.switchCompany.mockRejectedValue(new NotFoundException('User does not belong to company'));

      await expect(
        controller.switchCompany('Bearer valid.token', undefined, { companyId: 'org-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── exitCompany ───────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/exit-company', () => {
    it('restores global super-admin context and returns accessToken + csrfToken in body', async () => {
      const result = await controller.exitCompany('sgd_refresh_token=company.refresh.jwt; sgd_csrf_token=test-csrf', 'test-csrf');

      expect(authService.exitCompanyContext).toHaveBeenCalledWith('company.refresh.jwt');
      expect(result).toMatchObject({ accessToken: 'global.jwt', csrfToken: expect.any(String) });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('sets the new global refresh token as httpOnly cookie', async () => {
      const res = { cookie: jest.fn(), setHeader: jest.fn() };

      await controller.exitCompany('sgd_refresh_token=company.refresh.jwt; sgd_csrf_token=test-csrf', 'test-csrf', res as any);

      expect(res.cookie).toHaveBeenCalledWith(
        'sgd_refresh_token',
        'global-refresh.jwt',
        expect.any(Object),
      );
    });

    it('throws UnauthorizedException when no refresh cookie is present', async () => {
      await expect(controller.exitCompany(undefined, undefined)).rejects.toThrow(UnauthorizedException);

      expect(authService.exitCompanyContext).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when CSRF header is absent but cookie is present', async () => {
      await expect(
        controller.exitCompany('sgd_refresh_token=company.refresh.jwt; sgd_csrf_token=test-csrf', undefined),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.exitCompanyContext).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when CSRF header does not match the cookie', async () => {
      await expect(
        controller.exitCompany('sgd_refresh_token=company.refresh.jwt; sgd_csrf_token=test-csrf', 'wrong-csrf'),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.exitCompanyContext).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when refresh cookie is malformed', async () => {
      await expect(
        controller.exitCompany('sgd_refresh_token=%E0%A4%A; sgd_csrf_token=test-csrf', 'test-csrf'),
      ).rejects.toThrow(UnauthorizedException);

      expect(authService.exitCompanyContext).not.toHaveBeenCalled();
    });
  });
});
