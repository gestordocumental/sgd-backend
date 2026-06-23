import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { PermissionAction, PermissionModule } from './entities/permission.entity';

describe('PermissionsController', () => {
  const internalToken = 'internal-token';
  let controller: PermissionsController;
  let permissionsService: jest.Mocked<
    Pick<PermissionsService, 'findAll' | 'isUserSuperAdmin' | 'checkUserPermission'>
  >;

  beforeEach(() => {
    permissionsService = {
      findAll: jest.fn(),
      isUserSuperAdmin: jest.fn(),
      checkUserPermission: jest.fn(),
    };

    controller = new PermissionsController(
      permissionsService as unknown as PermissionsService,
      {
        getOrThrow: jest.fn().mockReturnValue(internalToken),
      } as unknown as ConfigService,
    );
  });

  it('returns all permissions', async () => {
    const permissions = [{ id: 'permission-1' }];
    permissionsService.findAll.mockResolvedValue(permissions as any);

    await expect(controller.findAll()).resolves.toBe(permissions);
    expect(permissionsService.findAll).toHaveBeenCalledTimes(1);
  });

  it('rejects check requests with an invalid internal token', async () => {
    await expect(
      controller.check(
        'wrong-token',
        'user-uuid-1',
        'org-uuid-1',
        PermissionModule.USERS,
        PermissionAction.READ,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(permissionsService.isUserSuperAdmin).not.toHaveBeenCalled();
  });

  it('allows super admins without checking role permissions', async () => {
    permissionsService.isUserSuperAdmin.mockResolvedValue(true);

    await expect(
      controller.check(
        internalToken,
        'user-uuid-1',
        'org-uuid-1',
        PermissionModule.USERS,
        PermissionAction.READ,
      ),
    ).resolves.toEqual({ allowed: true });
    expect(permissionsService.checkUserPermission).not.toHaveBeenCalled();
  });

  it('returns the role permission check result for regular users', async () => {
    permissionsService.isUserSuperAdmin.mockResolvedValue(false);
    permissionsService.checkUserPermission.mockResolvedValue(false);

    await expect(
      controller.check(
        internalToken,
        'user-uuid-1',
        'org-uuid-1',
        PermissionModule.USERS,
        PermissionAction.MANAGE,
      ),
    ).resolves.toEqual({ allowed: false });
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      'user-uuid-1',
      'org-uuid-1',
      PermissionModule.USERS,
      PermissionAction.MANAGE,
    );
  });
});
