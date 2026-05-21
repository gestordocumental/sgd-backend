import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// The internal token used across all internal-endpoint tests
const INTERNAL_TOKEN = 'my-super-secret-internal-token';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      provisionCredentials: jest.fn().mockResolvedValue({ ok: true }),
      disableCredential: jest.fn().mockResolvedValue(undefined),
      enableCredential: jest.fn().mockResolvedValue(undefined),
      login: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
      getMyCompanies: jest.fn().mockResolvedValue(['org-id']),
      switchCompany: jest.fn().mockResolvedValue({ accessToken: 'scoped.jwt', refreshToken: 'refresh.jwt' }),
      verifyAccessToken: jest.fn().mockReturnValue({ sub: 'user-id', email: 'user@test.com' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{
          ttl: 60_000,
          limit: 10,
        }]),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(INTERNAL_TOKEN),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── provisionCredentials ──────────────────────────────────────────────────

  describe('POST /api/auth/credentials/provision', () => {
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
  });

  // ── disableCredential ─────────────────────────────────────────────────────

  describe('PATCH /api/auth/credentials/:userId/disable', () => {
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

  // ── enableCredential ──────────────────────────────────────────────────────

  describe('PATCH /api/auth/credentials/:userId/enable', () => {
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

  describe('POST /api/auth/login', () => {
    it('delegates to authService.login and returns token pair', async () => {
      const dto = { email: 'user@test.com', password: 'pass1234' };

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('delegates to authService.refresh and returns new token pair', async () => {
      const result = await controller.refresh(undefined, { refreshToken: 'old.refresh.jwt' });

      expect(authService.refresh).toHaveBeenCalledWith('old.refresh.jwt');
      expect(result).toHaveProperty('accessToken');
    });
  });

  // ── me ────────────────────────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
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

  describe('GET /api/auth/me/companies', () => {
    it('returns list of companies for the authenticated user', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      const result = await controller.getMyCompanies('Bearer valid.token');

      expect(authService.getMyCompanies).toHaveBeenCalledWith('user-id');
      expect(result).toEqual(['org-id']);
    });
  });

  // ── switchCompany ─────────────────────────────────────────────────────────

  describe('POST /api/auth/switch-company', () => {
    it('returns scoped token pair for a valid company', async () => {
      authService.verifyAccessToken.mockReturnValue({ sub: 'user-id' });

      const result = await controller.switchCompany('Bearer valid.token', { companyId: 'org-id' });

      expect(authService.switchCompany).toHaveBeenCalledWith('user-id', 'org-id');
      expect(result).toHaveProperty('accessToken');
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
