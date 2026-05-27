import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { jwtPayloadFactory, JwtPayload } from '@sgd/common';

function makeCtx(user?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('jwtPayloadFactory', () => {
  it('returns the user payload when sub is present', () => {
    const payload: JwtPayload = { sub: 'user-1', companyId: 'org-1' };
    expect(jwtPayloadFactory(undefined, makeCtx(payload))).toEqual(payload);
  });

  it('throws UnauthorizedException when user is undefined', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx(undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user is null', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx(null))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when sub is missing', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx({ companyId: 'org-1' }))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when sub is empty string', () => {
    expect(() => jwtPayloadFactory(undefined, makeCtx({ sub: '' }))).toThrow(UnauthorizedException);
  });

  it('accepts payload with only sub (minimal valid payload)', () => {
    const payload: JwtPayload = { sub: 'user-42' };
    expect(jwtPayloadFactory(undefined, makeCtx(payload))).toEqual(payload);
  });
});
