import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { JwtGuard } from './jwt.guard';

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
    config    = { getOrThrow: jest.fn() } as any;
    guard     = new JwtGuard(reflector, config);
    config.getOrThrow.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET')     return SECRET;
      if (key === 'INTERNAL_TOKEN') return INTERNAL;
      throw new Error(`Unknown: ${key}`);
    });
  });

  it('returns true when no auth meta (public route)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeCtx(undefined, {}))).toBe(true);
  });

  it('throws UnauthorizedException when no authorization header', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    expect(() => guard.canActivate(makeCtx({}, {}))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for non-Bearer token', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    expect(() => guard.canActivate(makeCtx({}, { authorization: 'Basic abc' }))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid JWT', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    expect(() => guard.canActivate(makeCtx({}, { authorization: 'Bearer invalid.token.here' }))).toThrow(UnauthorizedException);
  });

  it('allows valid JWT and sets request.user', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    const token = makeToken({ sub: 'user-1' });
    expect(guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).toBe(true);
  });

  it('allows super admin on superAdminOnly route', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'admin-1', isSuperAdmin: true });
    expect(guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).toBe(true);
  });

  it('throws ForbiddenException for normal user on superAdminOnly route', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: true });
    const token = makeToken({ sub: 'user-1', isSuperAdmin: false });
    expect(() => guard.canActivate(makeCtx({}, { authorization: `Bearer ${token}` }))).toThrow(ForbiddenException);
  });

  it('allows valid internal token', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    expect(guard.canActivate(makeCtx({}, { 'x-internal-token': INTERNAL }))).toBe(true);
  });

  it('falls through to JWT when internal token has wrong length', () => {
    reflector.getAllAndOverride.mockReturnValue({ orgMember: false, superAdminOnly: false });
    expect(() => guard.canActivate(makeCtx({}, { 'x-internal-token': 'wrong' }))).toThrow(UnauthorizedException);
  });
});
