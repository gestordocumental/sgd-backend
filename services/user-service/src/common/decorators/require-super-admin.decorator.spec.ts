import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequireSuperAdmin } from './require-super-admin.decorator';

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

describe('@RequireSuperAdmin()', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => void;

  beforeEach(() => {
    factory = getDecoratorFactory(RequireSuperAdmin()) as (
      data: unknown,
      ctx: ExecutionContext,
    ) => void;
  });

  it('does not throw when the caller is a super admin', () => {
    const ctx = makeCtx({
      authorization: `Bearer ${buildJwt({ sub: 'user-1', isSuperAdmin: true })}`,
    });

    expect(() => factory(undefined, ctx)).not.toThrow();
  });

  it('throws ForbiddenException when the caller is not a super admin', () => {
    const ctx = makeCtx({
      authorization: `Bearer ${buildJwt({ sub: 'user-1', isSuperAdmin: false })}`,
    });

    expect(() => factory(undefined, ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when isSuperAdmin claim is absent', () => {
    const ctx = makeCtx({
      authorization: `Bearer ${buildJwt({ sub: 'user-1' })}`,
    });

    expect(() => factory(undefined, ctx)).toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    const ctx = makeCtx({});

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token does not start with "Bearer "', () => {
    const ctx = makeCtx({ authorization: 'Basic abc' });

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
});
