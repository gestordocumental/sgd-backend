import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalUsersController } from './internal-users.controller';
import { UsersService } from './users.service';

describe('InternalUsersController', () => {
  const internalToken = 'internal-token';
  let controller: InternalUsersController;
  let usersService: jest.Mocked<Pick<UsersService, 'findByPosition'>>;

  beforeEach(() => {
    usersService = {
      findByPosition: jest.fn(),
    };

    controller = new InternalUsersController(
      usersService as unknown as UsersService,
      {
        getOrThrow: jest.fn().mockReturnValue(internalToken),
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
});
