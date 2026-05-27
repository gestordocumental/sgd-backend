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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: { get: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: { find: jest.fn() },
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
    it('returns true without checking the token', async () => {
      reflector.get.mockReturnValue(undefined);
      const ctx = makeCtx({});

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ─── Internal token ───────────────────────────────────────────────────────

  describe('x-internal-token', () => {
    it('returns true when the internal token matches', async () => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockImplementation((key: string) => {
        if (key === 'INTERNAL_TOKEN') return INTERNAL_TOKEN;
        return JWT_SECRET;
      });

      const ctx = makeCtx({ 'x-internal-token': INTERNAL_TOKEN });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('does NOT short-circuit and falls through to JWT validation when internal token is wrong', async () => {
      reflector.get.mockReturnValue({ module: PermissionModule.USERS, action: PermissionAction.READ });
      configService.getOrThrow.mockImplementation((key: string) => {
        if (key === 'INTERNAL_TOKEN') return INTERNAL_TOKEN;
        return JWT_SECRET;
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
});
