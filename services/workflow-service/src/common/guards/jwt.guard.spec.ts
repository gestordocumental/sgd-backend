import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { JwtGuard } from './jwt.guard';
import { AUTH_KEY, AuthMeta } from '../decorators/auth.decorator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function buildToken(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const h = b64url(header);
  const p = b64url(payload);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function makeContext(opts: {
  meta?: AuthMeta;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}): ExecutionContext {
  const request = {
    headers: opts.headers ?? {},
    params: opts.params ?? {},
    user: undefined as unknown,
  };

  const reflector = {
    get: jest.fn().mockReturnValue(opts.meta),
  };

  const ctx = {
    getHandler: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
    _request: request,
  } as unknown as ExecutionContext;

  return { ...ctx, _reflector: reflector } as unknown as ExecutionContext;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-key';
const INTERNAL = 'internal-secret';

function buildGuard(meta?: AuthMeta, internalToken = INTERNAL) {
  const reflector = { get: jest.fn().mockReturnValue(meta) } as unknown as Reflector;
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return SECRET;
      if (key === 'INTERNAL_TOKEN') return internalToken;
      throw new Error(`Unknown key: ${key}`);
    }),
  } as unknown as ConfigService;

  const guard = new JwtGuard(reflector, config);
  return { guard, reflector, config };
}

function makeRequest(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  return { headers, params, user: undefined as unknown };
}

function makeCtx(
  request: ReturnType<typeof makeRequest>,
  meta?: AuthMeta,
): ExecutionContext {
  const reflector = { get: jest.fn().mockReturnValue(meta) };
  return {
    getHandler: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
    _reflector: reflector,
  } as unknown as ExecutionContext;
}

// Helper that wires a guard whose reflector returns the given meta
function guardWithMeta(meta?: AuthMeta) {
  const { guard } = buildGuard(meta);
  return guard;
}

// Simulate canActivate using the shared reflector mock
function activate(guard: JwtGuard, request: ReturnType<typeof makeRequest>, meta?: AuthMeta): boolean {
  const reflector = { get: jest.fn().mockReturnValue(meta) } as unknown as Reflector;
  // Replace the guard's reflector at runtime via casting
  (guard as unknown as { reflector: Reflector }).reflector = reflector;
  const ctx = {
    getHandler: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JwtGuard', () => {
  describe('no auth metadata (public route)', () => {
    it('returns true without inspecting the request', () => {
      const { guard, reflector } = buildGuard(undefined);
      const request = makeRequest();
      const result = activate(guard, request, undefined);
      expect(result).toBe(true);
    });
  });

  describe('internal token bypass', () => {
    const orgMemberMeta: AuthMeta = { orgMember: true, superAdminOnly: false };

    it('returns true when x-internal-token matches', () => {
      const { guard } = buildGuard(orgMemberMeta);
      const request = makeRequest({ 'x-internal-token': INTERNAL });
      expect(activate(guard, request, orgMemberMeta)).toBe(true);
    });

    it('falls through to JWT check when internal token does not match', () => {
      const { guard } = buildGuard(orgMemberMeta);
      const request = makeRequest({ 'x-internal-token': 'wrong-token' });
      expect(() => activate(guard, request, orgMemberMeta)).toThrow(UnauthorizedException);
    });
  });

  describe('missing / malformed authorization header', () => {
    const meta: AuthMeta = { orgMember: true, superAdminOnly: false };

    it('throws when Authorization header is absent', () => {
      const { guard } = buildGuard(meta);
      expect(() => activate(guard, makeRequest(), meta)).toThrow(UnauthorizedException);
    });

    it('throws when Authorization header does not start with Bearer', () => {
      const { guard } = buildGuard(meta);
      const request = makeRequest({ authorization: 'Basic abc' });
      expect(() => activate(guard, request, meta)).toThrow(UnauthorizedException);
    });
  });

  describe('JWT verification', () => {
    const meta: AuthMeta = { orgMember: false, superAdminOnly: false };

    it('returns true for a valid token with correct secret', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(activate(guard, request, meta)).toBe(true);
    });

    it('sets request.user to the decoded payload', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      activate(guard, request, meta);
      expect((request as { user: unknown }).user).toMatchObject({ sub: 'user-1' });
    });

    it('throws for wrong secret', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1' }, 'wrong-secret');
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(() => activate(guard, request, meta)).toThrow(UnauthorizedException);
    });

    it('throws for malformed token (only 2 parts)', () => {
      const { guard } = buildGuard(meta);
      const request = makeRequest({ authorization: 'Bearer abc.def' });
      expect(() => activate(guard, request, meta)).toThrow(UnauthorizedException);
    });

    it('throws for expired token', () => {
      const { guard } = buildGuard(meta);
      const exp = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
      const token = buildToken({ sub: 'user-1', exp }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(() => activate(guard, request, meta)).toThrow(UnauthorizedException);
    });

    it('throws for not-yet-valid token (nbf in the future)', () => {
      const { guard } = buildGuard(meta);
      const nbf = Math.floor(Date.now() / 1000) + 3600;
      const token = buildToken({ sub: 'user-1', nbf }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(() => activate(guard, request, meta)).toThrow(UnauthorizedException);
    });

    it('accepts a token that has not expired', () => {
      const { guard } = buildGuard(meta);
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = buildToken({ sub: 'user-1', exp, companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(activate(guard, request, meta)).toBe(true);
    });
  });

  describe('superAdmin access', () => {
    it('isSuperAdmin bypasses all checks', () => {
      const meta: AuthMeta = { orgMember: true, superAdminOnly: true };
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'admin-1', isSuperAdmin: true }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(activate(guard, request, meta)).toBe(true);
    });

    it('throws ForbiddenException when superAdminOnly and user is not superAdmin', () => {
      const meta: AuthMeta = { orgMember: false, superAdminOnly: true };
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(() => activate(guard, request, meta)).toThrow(ForbiddenException);
    });
  });

  describe('orgMember check', () => {
    const meta: AuthMeta = { orgMember: true, superAdminOnly: false };

    it('throws when token has no companyId', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1' }, SECRET); // no companyId
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(() => activate(guard, request, meta)).toThrow(ForbiddenException);
    });

    it('returns true when companyId present and no orgId in params', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` });
      expect(activate(guard, request, meta)).toBe(true);
    });

    it('returns true when companyId matches orgId param', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` }, { orgId: 'org-1' });
      expect(activate(guard, request, meta)).toBe(true);
    });

    it('throws ForbiddenException when companyId does not match orgId param', () => {
      const { guard } = buildGuard(meta);
      const token = buildToken({ sub: 'user-1', companyId: 'org-1' }, SECRET);
      const request = makeRequest({ authorization: `Bearer ${token}` }, { orgId: 'org-2' });
      expect(() => activate(guard, request, meta)).toThrow(ForbiddenException);
    });
  });
});
