import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { OrgId } from './org-id.decorator';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDecoratorFactory(decorator: ParameterDecorator) {
  class TestTarget {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test(@(decorator) _value: unknown) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestTarget, 'test') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  return args[Object.keys(args)[0]].factory;
}

function buildJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

function makeCtx(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('@OrgId()', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => string;

  beforeEach(() => {
    factory = getDecoratorFactory(OrgId()) as (data: unknown, ctx: ExecutionContext) => string;
  });

  it('returns the companyId claim from a valid JWT', () => {
    const companyId = 'org-uuid-1';
    const ctx = makeCtx({ authorization: `Bearer ${buildJwt({ companyId })}` });

    expect(factory(undefined, ctx)).toBe(companyId);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    const ctx = makeCtx({});

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token does not start with "Bearer "', () => {
    const ctx = makeCtx({ authorization: 'Token abc' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token has fewer than 3 parts', () => {
    const ctx = makeCtx({ authorization: 'Bearer header.payload' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the payload is not valid base64url JSON', () => {
    const ctx = makeCtx({ authorization: 'Bearer h.!!!.s' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when the payload has no companyId (global token)', () => {
    const ctx = makeCtx({ authorization: `Bearer ${buildJwt({ sub: 'user-uuid-1' })}` });

    expect(() => factory(undefined, ctx)).toThrow(ForbiddenException);
  });
});
