import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { JwtGuard } from '@sgd/common';

const SECRET   = 'test-secret';
const INTERNAL = 'internal-secret';

function makeToken(payload: Record<string, unknown>): string {
  return sign(payload, SECRET, { algorithm: 'HS256' });
}

function makeCtx(
  meta: unknown,
  headers: Record<string, string>,
): { ctx: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers, params: {} };
  const ctx = {
    getHandler: jest.fn(),
    getClass:   jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtGuard', () => {
  let guard:     JwtGuard;
  let reflector: jest.Mocked<Reflector>;
  let config:    jest.Mocked<ConfigService>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    config    = { getOrThrow: jest.fn(), get: jest.fn() } as any;
    guard     = new JwtGuard(reflector, config);

    config.getOrThrow.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return SECRET;
      throw new Error(`Unknown key: ${key}`);
    });
    config.get.mockImplementation((key: string) => {
      if (key === 'INTERNAL_TOKEN_AUTH_USER') return INTERNAL;
      return undefined;
    });
  });

  it('returns true when no auth meta (public route)', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const { ctx } = makeCtx(undefined, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws UnauthorizedException when no authorization header', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const { ctx } = makeCtx({}, {});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for non-Bearer token', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const { ctx } = makeCtx({}, { authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid JWT', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const { ctx } = makeCtx({}, { authorization: 'Bearer invalid.token.here' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('allows valid JWT and sets request.user', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const token = makeToken({ sub: 'user-1', isSuperAdmin: false });
    const { ctx, request } = makeCtx({}, { authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((request.user as any).sub).toBe('user-1');
  });

  it('allows super admin on superAdminOnly route', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'admin-1', isSuperAdmin: true });
    const { ctx } = makeCtx({}, { authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws ForbiddenException for normal user on superAdminOnly route', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'user-1', isSuperAdmin: false });
    const { ctx } = makeCtx({}, { authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows request with valid internal token', async () => {
    // getAllAndOverride is called twice: first for AUTH_KEY, then for INTERNAL_TOKEN_KEYS_META.
    // The second call simulates @AllowInternalTokens('INTERNAL_TOKEN_AUTH_USER') on the endpoint.
    reflector.getAllAndOverride
      .mockReturnValueOnce({ orgMember: false, superAdminOnly: false })
      .mockReturnValueOnce(['INTERNAL_TOKEN_AUTH_USER']);
    const { ctx } = makeCtx({}, { 'x-internal-token': INTERNAL });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('falls through to JWT check when internal token does not match', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce({ orgMember: false, superAdminOnly: false })
      .mockReturnValueOnce(['INTERNAL_TOKEN_AUTH_USER']);
    const { ctx } = makeCtx({}, { 'x-internal-token': 'wrong' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('default-deny: x-internal-token is ignored and falls through to JWT when no @AllowInternalTokens decorator is present', async () => {
    // First call returns auth meta; second returns undefined (no @AllowInternalTokens decorator).
    // A valid internal token must NOT bypass JWT validation — the endpoint never opted in.
    reflector.getAllAndOverride
      .mockReturnValueOnce({ orgMember: false, superAdminOnly: false })
      .mockReturnValueOnce(undefined);
    const { ctx } = makeCtx({}, { 'x-internal-token': INTERNAL });
    // No Authorization header → JWT check fails
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
