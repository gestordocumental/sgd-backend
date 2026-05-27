import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from './permissions.service';
import { Permission, PermissionModule, PermissionAction } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';
import { User } from '../users/entities/user.entity';

const makePermission = (overrides: Partial<Permission> = {}): Permission => ({
  id: 'perm-uuid-1',
  module: PermissionModule.DOCUMENTS,
  action: PermissionAction.READ,
  description: null,
  roles: [],
  ...overrides,
});

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionsRepo: jest.Mocked<Repository<Permission>>;
  let userOrgRoleRepo: jest.Mocked<Repository<UserOrgRole>>;
  let userRepo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: getRepositoryToken(Permission),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PermissionsService);
    permissionsRepo = module.get(getRepositoryToken(Permission));
    userOrgRoleRepo = module.get(getRepositoryToken(UserOrgRole));
    userRepo = module.get(getRepositoryToken(User));
  });

  describe('findAll', () => {
    it('returns all permissions ordered by module and action', async () => {
      const permissions = [
        makePermission({ module: PermissionModule.AUDIT, action: PermissionAction.READ }),
        makePermission({ module: PermissionModule.DOCUMENTS, action: PermissionAction.READ }),
      ];
      permissionsRepo.find.mockResolvedValue(permissions);

      const result = await service.findAll();

      expect(permissionsRepo.find).toHaveBeenCalledWith({
        order: { module: 'ASC', action: 'ASC' },
      });
      expect(result).toEqual(permissions);
    });

    it('returns empty array when there are no permissions', async () => {
      permissionsRepo.find.mockResolvedValue([]);

      expect(await service.findAll()).toEqual([]);
    });
  });

  describe('isUserSuperAdmin', () => {
    it('returns false when userId is empty', async () => {
      await expect(service.isUserSuperAdmin('')).resolves.toBe(false);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns true when the user is marked as super admin', async () => {
      userRepo.findOne.mockResolvedValue({ isSuperAdmin: true } as User);

      await expect(service.isUserSuperAdmin('user-uuid-1')).resolves.toBe(true);
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        select: ['isSuperAdmin'],
      });
    });

    it('returns false when the user is not found or is not super admin', async () => {
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ isSuperAdmin: false } as User);

      await expect(service.isUserSuperAdmin('missing-user')).resolves.toBe(false);
      await expect(service.isUserSuperAdmin('normal-user')).resolves.toBe(false);
    });
  });

  describe('checkUserPermission', () => {
    it('returns false when userId or orgId is missing', async () => {
      await expect(service.checkUserPermission('', 'org-uuid-1', 'users', 'read')).resolves.toBe(false);
      await expect(service.checkUserPermission('user-uuid-1', '', 'users', 'read')).resolves.toBe(false);
      expect(userOrgRoleRepo.find).not.toHaveBeenCalled();
    });

    it('returns true when any role has the requested permission', async () => {
      userOrgRoleRepo.find.mockResolvedValue([
        {
          role: {
            permissions: [
              { module: PermissionModule.USERS, action: PermissionAction.READ },
            ],
          },
        },
      ] as UserOrgRole[]);

      await expect(
        service.checkUserPermission(
          'user-uuid-1',
          'org-uuid-1',
          PermissionModule.USERS,
          PermissionAction.READ,
        ),
      ).resolves.toBe(true);
      expect(userOrgRoleRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', orgId: 'org-uuid-1' },
        relations: ['role', 'role.permissions'],
      });
    });

    it('returns false when no role contains the requested permission', async () => {
      userOrgRoleRepo.find.mockResolvedValue([
        { role: { permissions: [{ module: PermissionModule.DOCUMENTS, action: PermissionAction.READ }] } },
        { role: null },
      ] as UserOrgRole[]);

      await expect(
        service.checkUserPermission(
          'user-uuid-1',
          'org-uuid-1',
          PermissionModule.USERS,
          PermissionAction.MANAGE,
        ),
      ).resolves.toBe(false);
    });
  });
});
