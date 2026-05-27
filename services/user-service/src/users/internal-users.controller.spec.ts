import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalUsersController } from './internal-users.controller';
import { UsersService } from './users.service';

describe('InternalUsersController', () => {
  const internalToken = 'internal-token';
  let controller: InternalUsersController;
  let usersService: jest.Mocked<Pick<UsersService, 'findByPosition' | 'findManyByIds'>>;

  beforeEach(() => {
    usersService = {
      findByPosition: jest.fn(),
      findManyByIds:  jest.fn(),
    };

    controller = new InternalUsersController(
      usersService as unknown as UsersService,
      {
        getOrThrow: jest.fn().mockReturnValue(internalToken),
        get: jest.fn((key: string) => {
          if (
            [
              'INTERNAL_TOKEN_AUTH_USER',
              'INTERNAL_TOKEN_NOTIF_USER',
              'INTERNAL_TOKEN_WORKFLOW_USER',
              'INTERNAL_TOKEN_ORG_USER',
            ].includes(key)
          ) return internalToken;
          return undefined;
        }),
      } as unknown as ConfigService,
    );
  });

  it('delegates position lookup with all filters, including explicit null areaId', async () => {
    const users = [{ id: 'user-uuid-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }];
    usersService.findByPosition.mockResolvedValue(users);

    await expect(
      controller.byPosition(internalToken, {
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

    await controller.byPosition(internalToken, {
      orgId: 'org-uuid-1',
      cargoId: 'cargo-uuid-1',
    });

    expect(usersService.findByPosition).toHaveBeenCalledWith('org-uuid-1', {
      cargoId: 'cargo-uuid-1',
      departamentoId: undefined,
    });
  });

  it('rejects requests with a missing or invalid internal token', async () => {
    await expect(
      controller.byPosition(undefined, { orgId: 'org-uuid-1' }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      controller.byPosition('wrong-token', { orgId: 'org-uuid-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  describe('batchByIds()', () => {
    it('returns mapped users for valid ids', async () => {
      const users = [
        { id: 'u-1', firstName: 'Jane', lastName: 'Doe',  email: 'jane@example.com' },
        { id: 'u-2', firstName: '',     lastName: '',      email: 'noname@example.com' },
      ];
      usersService.findManyByIds.mockResolvedValue(users as any);

      const result = await controller.batchByIds(internalToken, { ids: ['u-1', 'u-2'] });

      expect(usersService.findManyByIds).toHaveBeenCalledWith(['u-1', 'u-2']);
      expect(result).toEqual([
        { id: 'u-1', email: 'jane@example.com',    fullName: 'Jane Doe' },
        { id: 'u-2', email: 'noname@example.com',  fullName: 'noname@example.com' },
      ]);
    });

    it('throws BadRequestException for an empty ids array', async () => {
      await expect(
        controller.batchByIds(internalToken, { ids: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when ids array exceeds 500 entries', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `user-${i}`);
      await expect(
        controller.batchByIds(internalToken, { ids }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when any id is an empty string', async () => {
      await expect(
        controller.batchByIds(internalToken, { ids: ['valid-id', ''] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException with an invalid token', async () => {
      await expect(
        controller.batchByIds('wrong-token', { ids: ['u-1'] }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
