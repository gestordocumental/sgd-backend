import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { Credential, CredentialStatus } from './entities/credential.entity';
import { UserClientService } from '../user-client/user-client.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashed'),
  compare: jest.fn(),
}));

const makeCredential = (overrides: Partial<Credential> = {}): Credential =>
  Object.assign(new Credential(), {
    id: 'cred-id',
    userId: 'user-id',
    email: 'user@test.com',
    passwordHash: '$2a$10$hashed',
    status: CredentialStatus.ACTIVE,
    refreshTokenHash: null,
    lockedUntil: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

describe('AuthService', () => {
  let service: AuthService;
  let credRepo: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let redis: Record<string, jest.Mock>;
  let userClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    credRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    jwtService = {
      sign: jest.fn().mockReturnValue('mock.jwt.token'),
      verify: jest.fn(),
    };
    redis = {
      setex: jest.fn().mockResolvedValue('OK'),
      getdel: jest.fn(),
    };
    userClient = {
      getUserInfo: jest.fn().mockResolvedValue({ isSuperAdmin: false }),
      getUserCompanies: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Credential), useValue: credRepo },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) =>
              ({
                JWT_SECRET: 'test-secret',
                JWT_REFRESH_SECRET: 'test-refresh-secret',
                JWT_EXPIRATION: '15m',
                JWT_REFRESH_EXPIRATION: '7d',
              }[key] ?? null),
            ),
            getOrThrow: jest.fn(),
          },
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: UserClientService, useValue: userClient },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── provisionCredentials ──────────────────────────────────────────────────

  describe('provisionCredentials', () => {
    const dto = { userId: 'user-id', email: 'user@test.com', password: 'password123' };

    it('creates new credentials when email does not exist', async () => {
      credRepo.findOne.mockResolvedValue(null);
      credRepo.create.mockReturnValue(makeCredential());
      credRepo.save.mockResolvedValue(makeCredential());

      const result = await service.provisionCredentials(dto);

      expect(credRepo.create).toHaveBeenCalled();
      expect(credRepo.save).toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:true idempotently when same userId already has a password', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());

      const result = await service.provisionCredentials(dto);

      expect(credRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('sets password when existing credential has no passwordHash', async () => {
      const existing = makeCredential({ passwordHash: null });
      credRepo.findOne.mockResolvedValue(existing);
      credRepo.save.mockResolvedValue(existing);

      const result = await service.provisionCredentials(dto);

      expect(credRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.ACTIVE }),
      );
      expect(result).toEqual({ ok: true });
    });

    it('throws ConflictException when email is registered for a different userId', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential({ userId: 'other-user-id' }));

      await expect(service.provisionCredentials(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when existing credential is DISABLED', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential({ status: CredentialStatus.DISABLED }));

      await expect(service.provisionCredentials(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { email: 'user@test.com', password: 'password123' };

    it('returns token pair on valid credentials', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(redis.setex).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when credential not found', async () => {
      credRepo.findOne.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when credential is DISABLED', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential({ status: CredentialStatus.DISABLED }));

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user profile not found in user-service (NotFoundException)', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userClient.getUserInfo.mockRejectedValue(
        new NotFoundException('User not found in user-service'),
      );

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('rethrows InternalServerErrorException from user-service', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userClient.getUserInfo.mockRejectedValue(
        new InternalServerErrorException('Connection refused'),
      );

      await expect(service.login(dto)).rejects.toThrow(InternalServerErrorException);
    });

    it('includes isSuperAdmin in access token payload when user is super admin', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: true });

      await service.login(dto);

      // First sign() call = access token
      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isSuperAdmin: true }),
        expect.any(Object),
      );
    });

    it('does not include isSuperAdmin in token when user is not super admin', async () => {
      credRepo.findOne.mockResolvedValue(makeCredential());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: false });

      await service.login(dto);

      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.not.objectContaining({ isSuperAdmin: expect.anything() }),
        expect.any(Object),
      );
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    const validPayload = {
      sub: 'user-id',
      email: 'user@test.com',
      jti: 'token-jti',
    };

    it('returns new token pair on valid refresh token (no companyId)', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential());

      const result = await service.refresh('valid.refresh.token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('returns new token pair preserving companyId when scope is still valid', async () => {
      jwtService.verify.mockReturnValue({ ...validPayload, companyId: 'org-id' });
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential());
      userClient.getUserCompanies.mockResolvedValue(['org-id', 'other-org-id']);

      const result = await service.refresh('valid.refresh.token');

      expect(result).toHaveProperty('accessToken');
      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ companyId: 'org-id' }),
        expect.any(Object),
      );
    });

    it('throws UnauthorizedException when refresh token signature is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(service.refresh('bad.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when refresh token is revoked (not in Redis)', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue(null);

      await expect(service.refresh('revoked.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when credential is not found', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('valid.refresh.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when credential is DISABLED', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential({ status: CredentialStatus.DISABLED }));

      await expect(service.refresh('valid.refresh.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when company scope has been revoked', async () => {
      jwtService.verify.mockReturnValue({ ...validPayload, companyId: 'org-id' });
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential());
      userClient.getUserCompanies.mockResolvedValue(['other-org-id']); // org-id removed

      await expect(service.refresh('valid.refresh.token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found in user-service during refresh', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential());
      userClient.getUserInfo.mockRejectedValue(new NotFoundException('User not found'));

      await expect(service.refresh('valid.refresh.token')).rejects.toThrow(UnauthorizedException);
    });

    it('stores new refresh token in Redis after successful rotation', async () => {
      jwtService.verify.mockReturnValue(validPayload);
      redis.getdel.mockResolvedValue('1');
      credRepo.findOne.mockResolvedValue(makeCredential());

      await service.refresh('valid.refresh.token');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('refresh:user-id:'),
        expect.any(Number),
        '1',
      );
    });
  });

  // ── disableCredential ─────────────────────────────────────────────────────

  describe('disableCredential', () => {
    it('disables an active credential', async () => {
      const cred = makeCredential();
      credRepo.findOne.mockResolvedValue(cred);
      credRepo.save.mockResolvedValue(cred);

      await service.disableCredential('user-id');

      expect(credRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.DISABLED }),
      );
    });

    it('is a no-op when credential does not exist', async () => {
      credRepo.findOne.mockResolvedValue(null);

      await service.disableCredential('unknown-id');

      expect(credRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── enableCredential ──────────────────────────────────────────────────────

  describe('enableCredential', () => {
    it('enables a disabled credential', async () => {
      const cred = makeCredential({ status: CredentialStatus.DISABLED });
      credRepo.findOne.mockResolvedValue(cred);
      credRepo.save.mockResolvedValue(cred);

      await service.enableCredential('user-id');

      expect(credRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.ACTIVE }),
      );
    });

    it('is a no-op when credential does not exist', async () => {
      credRepo.findOne.mockResolvedValue(null);

      await service.enableCredential('unknown-id');

      expect(credRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── verifyAccessToken ─────────────────────────────────────────────────────

  describe('verifyAccessToken', () => {
    it('returns decoded payload for a valid Bearer token', () => {
      const payload = { sub: 'user-id', email: 'user@test.com' };
      jwtService.verify.mockReturnValue(payload);

      const result = service.verifyAccessToken('Bearer valid.jwt.token');

      expect(result).toEqual(payload);
    });

    it('throws UnauthorizedException when Authorization header is empty', () => {
      expect(() => service.verifyAccessToken('')).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when header does not start with Bearer', () => {
      expect(() => service.verifyAccessToken('Token invalid.jwt')).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token is expired or invalid', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      expect(() => service.verifyAccessToken('Bearer expired.token')).toThrow(UnauthorizedException);
    });
  });

  // ── switchCompany ─────────────────────────────────────────────────────────

  describe('switchCompany', () => {
    it('returns scoped token pair when user belongs to the requested company', async () => {
      userClient.getUserCompanies.mockResolvedValue(['org-id', 'other-org-id']);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: false });
      credRepo.findOne.mockResolvedValue(makeCredential());

      const result = await service.switchCompany('user-id', 'org-id');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('includes companyId in the access token payload', async () => {
      userClient.getUserCompanies.mockResolvedValue(['org-id']);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: false });
      credRepo.findOne.mockResolvedValue(makeCredential());

      await service.switchCompany('user-id', 'org-id');

      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ companyId: 'org-id' }),
        expect.any(Object),
      );
    });

    it('throws NotFoundException when user does not belong to the requested company', async () => {
      userClient.getUserCompanies.mockResolvedValue(['other-org-id']);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: false });

      await expect(service.switchCompany('user-id', 'org-id')).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException when credential is inactive', async () => {
      userClient.getUserCompanies.mockResolvedValue(['org-id']);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: false });
      credRepo.findOne.mockResolvedValue(makeCredential({ status: CredentialStatus.DISABLED }));

      await expect(service.switchCompany('user-id', 'org-id')).rejects.toThrow(UnauthorizedException);
    });

    it('includes isSuperAdmin when user is super admin', async () => {
      userClient.getUserCompanies.mockResolvedValue(['org-id']);
      userClient.getUserInfo.mockResolvedValue({ isSuperAdmin: true });
      credRepo.findOne.mockResolvedValue(makeCredential());

      await service.switchCompany('user-id', 'org-id');

      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ companyId: 'org-id', isSuperAdmin: true }),
        expect.any(Object),
      );
    });
  });
});
