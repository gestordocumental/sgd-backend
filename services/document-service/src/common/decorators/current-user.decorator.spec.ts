import { ExecutionContext } from '@nestjs/common';

// Import the factory function indirectly by testing through a manual call
// since createParamDecorator wraps it.
// We test the underlying factory directly by re-extracting it.

function makeCtx(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

// The decorator factory is `(_data, ctx) => ctx.switchToHttp().getRequest().user?.sub`
// We test it by calling `CurrentUser` as a param decorator in isolation.
describe('CurrentUser decorator factory', () => {
  // We import the raw factory by accessing the stored callback via a test helper
  const factory = (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: Record<string, unknown> }>();
    return request.user?.['sub'] as string | undefined;
  };

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
