import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { OrgGuard } from './org.guard';
import { AuthMeta } from '../decorators/auth.decorator';

const TEST_JWT_SECRET = 'test-jwt-secret';

const buildJwt = (payload: Record<string, unknown>) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body   = encode(payload);
  const sig    = createHmac('sha256', TEST_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const makeContext = (
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    getClass:   () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({ headers, params }),
    }),
  }) as unknown as ExecutionContext;

describe('OrgGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let configService: {
    get: jest.Mock<string | undefined, [string]>;
    getOrThrow: jest.Mock<string, [string]>;
  };
  let guard: OrgGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
        throw new Error(`Unexpected key ${key}`);
      }),
      get: jest.fn((key: string) => {
        if (key === 'INTERNAL_TOKEN_NOTIF_ORG') return 'internal-secret';
        return undefined;
      }),
    };
    guard = new OrgGuard(reflector as unknown as Reflector, configService as unknown as ConfigService);
  });

  it('allows routes without auth metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('allows valid internal calls on non-super-admin endpoints', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(guard.canActivate(makeContext({ 'x-internal-token': 'internal-secret' }))).toBe(true);
  });

  it('rejects missing bearer token when no internal token is present', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('rejects malformed bearer tokens', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(() => guard.canActivate(makeContext({ authorization: 'Bearer bad.token' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows super admin access to everything', () => {
    reflector.getAllAndOverride.mockReturnValue({ superAdminOnly: true } satisfies AuthMeta);

    expect(
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1', isSuperAdmin: true })}` }),
      ),
    ).toBe(true);
  });

  it('rejects non-super-admin access on super-admin-only endpoints', () => {
    reflector.getAllAndOverride.mockReturnValue({ superAdminOnly: true } satisfies AuthMeta);

    expect(() =>
      guard.canActivate(makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1' })}` })),
    ).toThrow(ForbiddenException);
  });

  it('allows org members when companyId matches route :id', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(
      guard.canActivate(
        makeContext(
          { authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` },
          { id: 'org-1' },
        ),
      ),
    ).toBe(true);
  });

  it('allows org members when companyId matches nested route :orgId', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(
      guard.canActivate(
        makeContext(
          { authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-1' })}` },
          { orgId: 'org-1' },
        ),
      ),
    ).toBe(true);
  });

  it('rejects org-member routes when token has no companyId', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(() =>
      guard.canActivate(
        makeContext({ authorization: `Bearer ${buildJwt({ sub: 'user-1' })}` }, { orgId: 'org-1' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects access to a different organization', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: true } satisfies AuthMeta);

    expect(() =>
      guard.canActivate(
        makeContext(
          { authorization: `Bearer ${buildJwt({ sub: 'user-1', companyId: 'org-2' })}` },
          { orgId: 'org-1' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});
