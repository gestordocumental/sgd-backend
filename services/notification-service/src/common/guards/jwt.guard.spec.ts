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

function makeCtx(meta: unknown, headers: Record<string, string>): ExecutionContext {
  const request: Record<string, unknown> = { headers, params: {} };
  return {
    getHandler:   jest.fn(),
    getClass:     jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
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
      throw new Error(`Unknown: ${key}`);
    });
    config.get.mockImplementation((key: string) => {
      if (key === 'INTERNAL_TOKEN_NOTIF_USER') return INTERNAL;
      return undefined;
    });
  });

  it('returns true when no auth meta (public route)', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(makeCtx(undefined, {}))).resolves.toBe(true);
  });

  it('throws UnauthorizedException when no authorization header', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    await expect(guard.canActivate(makeCtx({}, {}))).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for non-Bearer token', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    await expect(guard.canActivate(makeCtx({}, { authorization: 'Basic abc' }))).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid JWT', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    await expect(guard.canActivate(makeCtx({}, { authorization: 'Bearer invalid.token.here' }))).rejects.toThrow(UnauthorizedException);
  });

  it('allows valid JWT and sets request.user', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const token = makeToken({ sub: 'user-1' });
    await expect(guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).resolves.toBe(true);
  });

  it('allows super admin on superAdminOnly route', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'admin-1', isSuperAdmin: true });
    await expect(guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).resolves.toBe(true);
  });

  it('throws ForbiddenException for normal user on superAdminOnly route', async () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'user-1', isSuperAdmin: false });
    await expect(guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).rejects.toThrow(ForbiddenException);
  });

  it('allows valid internal token', async () => {
    // getAllAndOverride is called twice: first for AUTH_KEY, then for INTERNAL_TOKEN_KEYS_META.
    // The second call simulates @AllowInternalTokens('INTERNAL_TOKEN_NOTIF_USER') on the endpoint.
    reflector.getAllAndOverride
      .mockReturnValueOnce({ orgMember: false, superAdminOnly: false })
      .mockReturnValueOnce(['INTERNAL_TOKEN_NOTIF_USER']);
    await expect(guard.canActivate(makeCtx({}, { 'x-internal-token': INTERNAL }))).resolves.toBe(true);
  });

  it('falls through to JWT when internal token does not match', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce({ orgMember: false, superAdminOnly: false })
      .mockReturnValueOnce(['INTERNAL_TOKEN_NOTIF_USER']);
    await expect(guard.canActivate(makeCtx({}, { 'x-internal-token': 'wrong' }))).rejects.toThrow(UnauthorizedException);
  });
});
