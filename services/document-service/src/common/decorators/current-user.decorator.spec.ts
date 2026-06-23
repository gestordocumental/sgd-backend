import { ExecutionContext } from '@nestjs/common';
import { currentUserFactory } from './current-user.decorator';

function makeCtx(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser decorator factory', () => {
  const factory = currentUserFactory;

  it('returns sub from request.user when present', () => {
    const ctx = makeCtx({ sub: 'user-1', email: 'test@test.com' });
    expect(factory(undefined, ctx)).toBe('user-1');
  });

  it('returns undefined when request.user is absent', () => {
    const ctx = makeCtx(undefined);
    expect(factory(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when user has no sub field', () => {
    const ctx = makeCtx({ email: 'test@test.com' });
    expect(factory(undefined, ctx)).toBeUndefined();
  });
});
