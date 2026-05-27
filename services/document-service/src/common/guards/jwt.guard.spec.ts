import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { JwtGuard, AUTH_KEY, AuthMeta } from '@sgd/common';

// ── Helpers ─────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-key-32-chars-minimum!!';
const INTERNAL_TOKEN = 'super-secret-internal-token';

function signJwt(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig     = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function makeReflector(meta: AuthMeta | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(meta) } as any;
}

function makeConfig(overrides: Record<string, string> = {}) {
  const cfg: Record<string, string> = {
    JWT_SECRET:                  JWT_SECRET,
    INTERNAL_TOKEN_WORKFLOW_DOC: INTERNAL_TOKEN,
    ...overrides,
  };
  return {
    getOrThrow: jest.fn((key: string) => cfg[key]),
    get:        jest.fn((key: string) => cfg[key]),
  } as any;
}

function makeContext(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  return {
    getHandler:   jest.fn(),
    getClass:     jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ headers, params }),
    }),
  } as any;
}

// ── JwtGuard ─────────────────────────────────────────────────────────────────

describe('JwtGuard', () => {
  // ── No auth meta (public route) ──────────────────────────────────────────

  describe('when route has no @Auth decorator (meta is undefined)', () => {
    it('returns true without checking headers', async () => {
      const guard = new JwtGuard(makeReflector(undefined), makeConfig());
      const ctx   = makeContext({});
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ── Internal token ───────────────────────────────────────────────────────

  describe('x-internal-token', () => {
    const meta: AuthMeta = { orgMember: true, superAdminOnly: false };

    it('returns true when internal token matches', async () => {
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ 'x-internal-token': INTERNAL_TOKEN });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('falls through to JWT check when internal token does NOT match', async () => {
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ 'x-internal-token': 'wrong-token' });
      // No bearer token either → should throw
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── JWT validation ───────────────────────────────────────────────────────

  describe('JWT Bearer token', () => {
    const meta: AuthMeta = { orgMember: false, superAdminOnly: false };

    it('returns true for a valid JWT with no special claims needed', async () => {
      const token = signJwt({ sub: 'user-1' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({});
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when Authorization does not start with Bearer', async () => {
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: 'Basic abc' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a malformed JWT (wrong number of parts)', async () => {
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: 'Bearer only.two' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when signature is invalid', async () => {
      const token = signJwt({ sub: 'user-1' }, 'wrong-secret');
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

  });

  // ── Super admin ──────────────────────────────────────────────────────────

  describe('superAdminOnly routes', () => {
    const meta: AuthMeta = { orgMember: false, superAdminOnly: true };

    it('allows isSuperAdmin payload', async () => {
      const token = signJwt({ sub: 'admin', isSuperAdmin: true });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws ForbiddenException when user is not superAdmin on superAdminOnly route', async () => {
      const token = signJwt({ sub: 'user', companyId: 'org-1' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── orgMember ────────────────────────────────────────────────────────────

  describe('orgMember routes', () => {
    const meta: AuthMeta = { orgMember: true, superAdminOnly: false };

    it('returns true when companyId matches orgId param', async () => {
      const token = signJwt({ sub: 'user', companyId: 'org-abc' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` }, { orgId: 'org-abc' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('throws ForbiddenException when companyId does NOT match orgId param', async () => {
      const token = signJwt({ sub: 'user', companyId: 'org-abc' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` }, { orgId: 'org-xyz' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when token has no companyId', async () => {
      const token = signJwt({ sub: 'user' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` }, { orgId: 'org-abc' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('returns true when isSuperAdmin regardless of orgId', async () => {
      const token = signJwt({ sub: 'admin', isSuperAdmin: true });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` }, { orgId: 'any-org' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('returns true when no orgId param is present (route without :orgId)', async () => {
      const token = signJwt({ sub: 'user', companyId: 'org-abc' });
      const guard = new JwtGuard(makeReflector(meta), makeConfig());
      const ctx   = makeContext({ authorization: `Bearer ${token}` }, {});
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
