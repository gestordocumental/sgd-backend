import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalGuard } from './internal.guard';

const INTERNAL_TOKEN = 'secret-internal-token';

function makeCtx(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function makeConfig(): jest.Mocked<ConfigService> {
  // Guard reads INTERNAL_TOKEN_NOTIF_ORG and INTERNAL_TOKEN_DOC_ORG via configService.get()
  return {
    get: jest.fn((key: string) => {
      if (key === 'INTERNAL_TOKEN_NOTIF_ORG') return INTERNAL_TOKEN;
      return undefined;
    }),
  } as any;
}

describe('InternalGuard', () => {
  it('throws UnauthorizedException when x-internal-token header is missing', () => {
    const guard = new InternalGuard(makeConfig());
    expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is invalid', () => {
    const guard = new InternalGuard(makeConfig());
    expect(() => guard.canActivate(makeCtx({ 'x-internal-token': 'wrong-token' }))).toThrow(UnauthorizedException);
  });

  it('returns true for a valid internal token', () => {
    const guard = new InternalGuard(makeConfig());
    expect(guard.canActivate(makeCtx({ 'x-internal-token': INTERNAL_TOKEN }))).toBe(true);
  });

  it('throws when no tokens are configured', () => {
    const emptyConfig = { get: jest.fn().mockReturnValue(undefined) } as any;
    expect(() => new InternalGuard(emptyConfig)).toThrow('no internal tokens configured');
  });
});
