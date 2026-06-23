import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtPayloadParam } from '@sgd/common';

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

function makeCtx(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
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
    const ctx = makeCtx(payload);

    expect(factory(undefined, ctx)).toEqual(payload);
  });

  it('throws UnauthorizedException when request.user is missing', () => {
    const ctx = makeCtx(undefined);

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user.sub is missing', () => {
    const ctx = makeCtx({ email: 'user@example.com' });

    expect(() => factory(undefined, ctx)).toThrow(UnauthorizedException);
  });
});
