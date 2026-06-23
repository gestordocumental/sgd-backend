import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { jwtPayloadFactory } from '@sgd/common';

function makeCtx(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('jwtPayloadFactory', () => {
  it('throws UnauthorizedException when user is absent', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx(undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user has no sub field', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx({ email: 'test@test.com' }))).toThrow(UnauthorizedException);
  });

  it('returns the user payload when sub is present', () => {
    const user = { sub: 'user-1', email: 'test@test.com' };
    expect(jwtPayloadFactory(undefined, makeCtx(user as any))).toBe(user);
  });
});
