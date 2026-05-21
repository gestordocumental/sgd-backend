import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtPayloadParam } from './jwt-payload.decorator';

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

describe('@JwtPayloadParam()', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => unknown;

  beforeEach(() => {
    factory = getDecoratorFactory(JwtPayloadParam());
  });

  it('returns the decoded JWT payload', () => {
    const payload = { sub: 'user-1', companyId: 'org-1', isSuperAdmin: false };
    const ctx = makeCtx({ authorization: `Bearer ${buildJwt(payload)}` });

    expect(factory(undefined, ctx)).toEqual(payload);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    const ctx = makeCtx({});

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token is not bearer', () => {
    const ctx = makeCtx({ authorization: 'Basic abc' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token has fewer than 3 parts', () => {
    const ctx = makeCtx({ authorization: 'Bearer header.payload' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the payload is not valid JSON', () => {
    const ctx = makeCtx({ authorization: 'Bearer header.!!!invalid!!!.signature' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });
});
