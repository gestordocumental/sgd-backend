import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUserId } from './current-user-id.decorator';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts the inner factory function from a createParamDecorator result.
 * NestJS stores the factory under ROUTE_ARGS_METADATA on the test class.
 */
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

describe('@CurrentUserId()', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => string;

  beforeEach(() => {
    factory = getDecoratorFactory(CurrentUserId()) as (
      data: unknown,
      ctx: ExecutionContext,
    ) => string;
  });

  it('returns the sub claim from a valid JWT', () => {
    const sub = 'user-uuid-1';
    const ctx = makeCtx({ authorization: `Bearer ${buildJwt({ sub })}` });

    expect(factory(undefined, ctx)).toBe(sub);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    const ctx = makeCtx({});

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token does not start with "Bearer "', () => {
    const ctx = makeCtx({ authorization: 'Basic abc123' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token has fewer than 3 parts', () => {
    const ctx = makeCtx({ authorization: 'Bearer header.payload' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the payload is not valid base64url JSON', () => {
    const ctx = makeCtx({ authorization: 'Bearer header.!!!invalid!!!.signature' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the payload has no sub claim', () => {
    const ctx = makeCtx({ authorization: `Bearer ${buildJwt({ role: 'admin' })}` });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });
});
