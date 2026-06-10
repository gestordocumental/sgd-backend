import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InternalGuard, INTERNAL_TOKEN_KEYS_META } from '@sgd/common';
import { InternalUsersController } from './internal-users.controller';
import { UsersService } from './users.service';

describe('InternalUsersController', () => {
  let controller: InternalUsersController;
  let usersService: jest.Mocked<Pick<UsersService, 'findByPosition' | 'findManyByIds'>>;

  beforeEach(() => {
    usersService = {
      findByPosition: jest.fn(),
      findManyByIds:  jest.fn(),
    };

    controller = new InternalUsersController(usersService as unknown as UsersService);
  });

  it('delegates position lookup with all filters, including explicit null areaId', async () => {
    const users = [{ id: 'user-uuid-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }];
    usersService.findByPosition.mockResolvedValue(users);

    await expect(
      controller.byPosition({
        orgId: 'org-uuid-1',
        cargoId: 'cargo-uuid-1',
        areaId: null,
        departamentoId: 'departamento-uuid-1',
      }),
    ).resolves.toBe(users);

    expect(usersService.findByPosition).toHaveBeenCalledWith('org-uuid-1', {
      cargoId: 'cargo-uuid-1',
      areaId: null,
      departamentoId: 'departamento-uuid-1',
    });
  });

  it('omits areaId from filters when it is not present in the request body', async () => {
    usersService.findByPosition.mockResolvedValue([]);

    await controller.byPosition({
      orgId: 'org-uuid-1',
      cargoId: 'cargo-uuid-1',
    });

    expect(usersService.findByPosition).toHaveBeenCalledWith('org-uuid-1', {
      cargoId: 'cargo-uuid-1',
      departamentoId: undefined,
    });
  });

  describe('batchByIds()', () => {
    it('returns mapped users for valid ids', async () => {
      const users = [
        { id: 'u-1', firstName: 'Jane', lastName: 'Doe',  email: 'jane@example.com' },
        { id: 'u-2', firstName: '',     lastName: '',      email: 'noname@example.com' },
      ];
      usersService.findManyByIds.mockResolvedValue(users as any);

      const result = await controller.batchByIds({ ids: ['u-1', 'u-2'] });

      expect(usersService.findManyByIds).toHaveBeenCalledWith(['u-1', 'u-2']);
      expect(result).toEqual([
        { id: 'u-1', email: 'jane@example.com',    fullName: 'Jane Doe' },
        { id: 'u-2', email: 'noname@example.com',  fullName: 'noname@example.com' },
      ]);
    });

    it('throws BadRequestException for an empty ids array', async () => {
      await expect(
        controller.batchByIds({ ids: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when ids array exceeds 500 entries', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `user-${i}`);
      await expect(
        controller.batchByIds({ ids }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when any id is an empty string', async () => {
      await expect(
        controller.batchByIds({ ids: ['valid-id', ''] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Security contract ──────────────────────────────────────────────────────

  describe('security contract', () => {
    const NOTIF_KEY    = 'INTERNAL_TOKEN_NOTIF_USER';
    const WORKFLOW_KEY = 'INTERNAL_TOKEN_WORKFLOW_USER';

    describe('declarative metadata', () => {
      it('applies @UseGuards(InternalGuard) at controller class level', () => {
        const guards = (Reflect.getMetadata('__guards__', InternalUsersController) ?? []) as (new (...args: unknown[]) => unknown)[];
        expect(guards).toContain(InternalGuard);
      });

      it('restricts batchByIds to INTERNAL_TOKEN_NOTIF_USER', () => {
        const keys = (Reflect.getMetadata(INTERNAL_TOKEN_KEYS_META, InternalUsersController.prototype.batchByIds) ?? []) as string[];
        expect(keys).toContain(NOTIF_KEY);
      });

      it('restricts byPosition to INTERNAL_TOKEN_WORKFLOW_USER', () => {
        const keys = (Reflect.getMetadata(INTERNAL_TOKEN_KEYS_META, InternalUsersController.prototype.byPosition) ?? []) as string[];
        expect(keys).toContain(WORKFLOW_KEY);
      });
    });

    describe('InternalGuard.canActivate()', () => {
      function makeGuard(
        envTokens: Record<string, string>,
        handlerKeys: string[] = [NOTIF_KEY],
      ) {
        const reflector     = { getAllAndOverride: jest.fn().mockReturnValue(handlerKeys) };
        const configService = { get: jest.fn((key: string) => envTokens[key]) };
        return new InternalGuard(
          reflector as unknown as Reflector,
          configService as unknown as ConfigService,
        );
      }

      function makeCtx(headers: Record<string, string> = {}): any {
        return {
          switchToHttp: () => ({
            getRequest: () => ({
              socket: { remoteAddress: '127.0.0.1' },
              headers,
            }),
          }),
          getHandler: () => InternalUsersController.prototype.batchByIds,
          getClass:   () => InternalUsersController,
        };
      }

      it('throws UnauthorizedException when x-internal-token header is absent', () => {
        const guard = makeGuard({ [NOTIF_KEY]: 'secret-notif' });
        expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
      });

      it('throws UnauthorizedException when x-internal-token does not match', () => {
        const guard = makeGuard({ [NOTIF_KEY]: 'secret-notif' });
        expect(() => guard.canActivate(makeCtx({ 'x-internal-token': 'wrong-value' }))).toThrow(UnauthorizedException);
      });

      it('returns true when the correct token for the endpoint is provided', () => {
        const guard = makeGuard({ [NOTIF_KEY]: 'secret-notif' });
        expect(guard.canActivate(makeCtx({ 'x-internal-token': 'secret-notif' }))).toBe(true);
      });

      it('rejects a valid token intended for a different endpoint', () => {
        const guard = makeGuard(
          { [NOTIF_KEY]: 'notif-token', [WORKFLOW_KEY]: 'workflow-token' },
          [NOTIF_KEY], // batchByIds allows only the notif token
        );
        expect(() => guard.canActivate(makeCtx({ 'x-internal-token': 'workflow-token' }))).toThrow(UnauthorizedException);
      });

      it('throws UnauthorizedException when no token env vars are configured for the endpoint', () => {
        const guard = makeGuard({}, [NOTIF_KEY]); // env var exists in metadata but has no value
        expect(() => guard.canActivate(makeCtx({ 'x-internal-token': 'any-token' }))).toThrow(UnauthorizedException);
      });
    });
  });
});
