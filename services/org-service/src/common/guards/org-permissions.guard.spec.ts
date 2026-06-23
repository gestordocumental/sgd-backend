import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { OrgPermissionsGuard } from './org-permissions.guard';
import { OrgPermissionMeta } from '../decorators/require-org-permission.decorator';

import { createHmac } from 'crypto';

const TEST_JWT_SECRET = 'test-jwt-secret';

const buildJwt = (payload: Record<string, unknown>) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body   = encode(payload);
  const sig    = createHmac('sha256', TEST_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const makeContext = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  }) as unknown as ExecutionContext;

describe('OrgPermissionsGuard', () => {
  let reflector: { get: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let guard: OrgPermissionsGuard;
  let fetchMock: jest.Mock;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    reflector = { get: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'USER_SERVICE_URL')      return 'http://user-service';
        if (key === 'INTERNAL_TOKEN_ORG_USER') return 'internal-secret';
        if (key === 'JWT_SECRET')            return TEST_JWT_SECRET;
        throw new Error(`Unexpected key ${key}`);
      }),
    };
    guard = new OrgPermissionsGuard(
      reflector as unknown as Reflector,
      configService as unknown as ConfigService,
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('allows routes without permission metadata', async () => {
    reflector.get.mockReturnValue(undefined);

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('allows super admin without calling user-service', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', isSuperAdmin: true })}` }),
      ),
    ).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing bearer token', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);

    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed bearer token', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);

    await expect(guard.canActivate(makeContext({ authorization: 'Bearer bad.token' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects tokens without sub claim', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);

    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${buildJwt({ companyId: 'org-1' })}` })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects tokens without companyId claim', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);

    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1' })}` })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows access when user-service returns allowed=true', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ allowed: true }),
    });

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` }),
      ),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://user-service/api/v1/permissions/check?userId=user-1&orgId=org-1&module=ORG_STRUCTURE&action=READ',
      expect.objectContaining({
        headers: { 'x-internal-token': 'internal-secret' },
      }),
    );
  });

  it('rejects access when user-service returns allowed=false', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ allowed: false }),
    });

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps 403 responses to ForbiddenException', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps unexpected response status to InternalServerErrorException', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` }),
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('maps fetch failures to InternalServerErrorException', async () => {
    reflector.get.mockReturnValue({ module: 'ORG_STRUCTURE', action: 'READ' } satisfies OrgPermissionMeta);
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` }),
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
