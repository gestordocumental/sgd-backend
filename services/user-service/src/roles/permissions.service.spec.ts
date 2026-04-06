import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from './permissions.service';
import { Permission, PermissionModule, PermissionAction } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';

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
      ],
    }).compile();

    service = module.get(PermissionsService);
    permissionsRepo = module.get(getRepositoryToken(Permission));
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
});
