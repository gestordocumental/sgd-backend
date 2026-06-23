import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { PermissionsGuard } from './permissions.guard';
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from '../../roles/entities/permission.entity';

// ─── Helpers ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-key';
const INTERNAL_TOKEN = 'super-secret-internal-token';

function buildJwt(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const payloadWithDefaults = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...payload,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payloadWithDefaults)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function makeCtx(
  headers: Record<string, string>,
  handler?: object,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
    getHandler: () => handler ?? {},
  } as unknown as ExecutionContext;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let configService: jest.Mocked<ConfigService>;
  let uorRepo: jest.Mocked<Repository<UserOrgRole>>;
  let redisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    redisClient = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: { get: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn(), get: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: { find: jest.fn() },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: redisClient,
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
    configService = module.get(ConfigService);
    uorRepo = module.get(getRepositoryToken(UserOrgRole));
  });

  // ─── No permission required ───────────────────────────────────────────────

  describe('when no @RequirePermission is set', () => {
    it('returns true without a token (public endpoint)', async () => {
      reflector.get.mockReturnValue(undefined);
      const ctx = makeCtx({});

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('decodes JWT and populates request.user even without @RequirePermission', async () => {
      reflector.get.mockReturnValue(undefined);
      configService.getOrThrow.mockReturnValue(JWT_SECRET);

      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request['user']).toMatchObject({ sub: 'user-1', companyId: 'org-1' });
    });
  });

  // ─── Internal token ───────────────────────────────────────────────────────

  describe('x-internal-token', () => {
    it('returns true when the internal token matches', async () => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
      configService.get.mockImplementation((key: string) => {
        if (key === 'INTERNAL_TOKEN_AUTH_USER') return INTERNAL_TOKEN;
        return undefined;
      });

      const ctx = makeCtx({ 'x-internal-token': INTERNAL_TOKEN });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('does NOT short-circuit and falls through to JWT validation when internal token is wrong', async () => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
      configService.get.mockImplementation((key: string) => {
        if (key === 'INTERNAL_TOKEN_AUTH_USER') return INTERNAL_TOKEN;
        return undefined;
      });

      // Wrong internal token — will try JWT next, which is missing → UnauthorizedException
      const ctx = makeCtx({ 'x-internal-token': 'wrong-token' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Missing / malformed Authorization header ─────────────────────────────

  describe('Authorization header validation', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const ctx = makeCtx({});

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when header does not start with "Bearer "', async () => {
      const ctx = makeCtx({ authorization: 'Basic abc' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when JWT has wrong number of parts', async () => {
      const ctx = makeCtx({ authorization: 'Bearer only.two' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when JWT signature is invalid', async () => {
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' }, 'wrong-secret');
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Super-admin bypass ───────────────────────────────────────────────────

  describe('super-admin', () => {
    it('returns true for a super-admin token without checking org roles', async () => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.MANAGE });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);

      const token = buildJwt({ sub: 'admin-1', isSuperAdmin: true });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(uorRepo.find).not.toHaveBeenCalled();
    });
  });

  // ─── Missing sub / companyId ──────────────────────────────────────────────

  describe('missing claims', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
    });

    it('throws UnauthorizedException when token has no sub claim', async () => {
      const token = buildJwt({ companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when token has no companyId', async () => {
      const token = buildJwt({ sub: 'user-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Role / permission checks ─────────────────────────────────────────────

  describe('permission evaluation', () => {
    const required = { module: PermissionModule.USERS, action: PermissionAction.READ };

    beforeEach(() => {
      reflector.get.mockReturnValue(required);
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
    });

    it('throws ForbiddenException when the user has no roles in the org', async () => {
      uorRepo.find.mockResolvedValue([]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when none of the user roles have the required permission', async () => {
      uorRepo.find.mockResolvedValue([
        {
          role: {
            permissions: [
              { module: PermissionModule.DOCUMENTS, action: PermissionAction.READ },
            ],
          },
        } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('returns true when the user has the required permission in one of their roles', async () => {
      uorRepo.find.mockResolvedValue([
        {
          role: {
            permissions: [
              { module: PermissionModule.USERS, action: PermissionAction.READ },
            ],
          },
        } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('returns true when one of multiple roles has the required permission', async () => {
      uorRepo.find.mockResolvedValue([
        {
          role: {
            permissions: [{ module: PermissionModule.DOCUMENTS, action: PermissionAction.READ }],
          },
        } as unknown as UserOrgRole,
        {
          role: {
            permissions: [{ module: PermissionModule.USERS, action: PermissionAction.READ }],
          },
        } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('queries userOrgRoleRepo with correct userId and orgId', async () => {
      uorRepo.find.mockResolvedValue([
        {
          role: {
            permissions: [{ module: PermissionModule.USERS, action: PermissionAction.READ }],
          },
        } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-abc', companyId: 'org-xyz' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await guard.canActivate(ctx);

      expect(uorRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-abc', orgId: 'org-xyz' },
        relations: ['role', 'role.permissions'],
      });
    });

    it('populates request.user with the decoded JWT payload', async () => {
      uorRepo.find.mockResolvedValue([
        {
          role: { permissions: [{ module: PermissionModule.USERS, action: PermissionAction.READ }] },
        } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);

      expect(request['user']).toMatchObject({ sub: 'user-1', companyId: 'org-1' });
    });

    it('handles a role with null permissions gracefully', async () => {
      uorRepo.find.mockResolvedValue([
        { role: { permissions: null } } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('handles a null role gracefully', async () => {
      uorRepo.find.mockResolvedValue([
        { role: null } as unknown as UserOrgRole,
      ]);
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── JWT expiry and malformed payload ────────────────────────────────────

  describe('JWT edge cases', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
    });

    it('throws UnauthorizedException when JWT is expired', async () => {
      const token = buildJwt({ sub: 'user-1', companyId: 'org-1', exp: Math.floor(Date.now() / 1000) - 60 });
      const ctx = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when JWT payload is not valid JSON', async () => {
      const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from('not-valid-json{{{').toString('base64url');
      const sig     = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
      const token   = `${header}.${payload}.${sig}`;
      const ctx     = makeCtx({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Cache behaviour ─────────────────────────────────────────────────────

  describe('cache behaviour', () => {
    const required = { module: PermissionModule.USERS, action: PermissionAction.READ };
    const orgRoles = [
      {
        role: { permissions: [{ module: PermissionModule.USERS, action: PermissionAction.READ }] },
      } as unknown as UserOrgRole,
    ];

    beforeEach(() => {
      reflector.get.mockReturnValue(required);
      configService.getOrThrow.mockReturnValue(JWT_SECRET);
    });

    it('returns cached permissions on second call without hitting the repo again', async () => {
      uorRepo.find.mockResolvedValue(orgRoles);
      const serialized = JSON.stringify([{ module: PermissionModule.USERS, action: PermissionAction.READ }]);
      // First call: cache miss; second call: Redis cache hit
      redisClient.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(serialized);

      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx   = makeCtx({ authorization: `Bearer ${token}` });

      await guard.canActivate(ctx);
      await guard.canActivate(ctx);

      expect(uorRepo.find).toHaveBeenCalledTimes(1);
    });

    it('invalidate() forces the next call to re-fetch from the repo', async () => {
      uorRepo.find.mockResolvedValue(orgRoles);
      // Both calls are cache misses (redis.del clears the key)
      redisClient.get.mockResolvedValue(null);

      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx   = makeCtx({ authorization: `Bearer ${token}` });

      await guard.canActivate(ctx);           // populates Redis cache
      await guard.invalidate('user-1', 'org-1'); // evicts from Redis
      await guard.canActivate(ctx);           // cache miss → hits repo again

      expect(redisClient.del).toHaveBeenCalledWith('perms:user-1:org-1');
      expect(uorRepo.find).toHaveBeenCalledTimes(2);
    });

    it('caches permissions in Redis with a 120-second TTL', async () => {
      uorRepo.find.mockResolvedValue(orgRoles);
      redisClient.get.mockResolvedValue(null);

      const token = buildJwt({ sub: 'user-1', companyId: 'org-1' });
      const ctx   = makeCtx({ authorization: `Bearer ${token}` });

      await guard.canActivate(ctx);

      expect(redisClient.set).toHaveBeenCalledWith(
        'perms:user-1:org-1',
        expect.any(String),
        'EX',
        120,
      );
    });
  });
});
