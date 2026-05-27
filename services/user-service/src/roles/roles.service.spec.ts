import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RolesService } from './roles.service';
import { Role, RoleScope } from './entities/role.entity';
import { Permission, PermissionModule, PermissionAction } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-1';

const makePermission = (overrides: Partial<Permission> = {}): Permission => ({
  id: 'perm-uuid-1',
  module: PermissionModule.DOCUMENTS,
  action: PermissionAction.READ,
  description: null,
  roles: [],
  ...overrides,
});

const makeRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-uuid-1',
  name: 'Custom Role',
  scope: RoleScope.ORG,
  description: null,
  isSystem: false,
  orgId: ORG_ID,
  permissions: [],
  userOrgRoles: [],
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

const makeSystemRole = (overrides: Partial<Role> = {}): Role =>
  makeRole({ isSystem: true, orgId: null, scope: RoleScope.SYSTEM, ...overrides });

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('RolesService', () => {
  let service: RolesService;
  let rolesRepo: jest.Mocked<Repository<Role>>;
  let permissionsRepo: jest.Mocked<Repository<Permission>>;
  let uorRepo: jest.Mocked<Repository<UserOrgRole>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(Role),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            findBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Permission),
          useValue: { findBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: { countBy: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(RolesService);
    rolesRepo = module.get(getRepositoryToken(Role));
    permissionsRepo = module.get(getRepositoryToken(Permission));
    uorRepo = module.get(getRepositoryToken(UserOrgRole));
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns system roles and org-scoped roles together', async () => {
      const roles = [makeSystemRole(), makeRole()];
      rolesRepo.find.mockResolvedValue(roles);

      const result = await service.findAll(ORG_ID);

      expect(rolesRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['permissions'] }),
      );
      expect(result).toEqual(roles);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the role when found', async () => {
      const role = makeRole();
      rolesRepo.findOne.mockResolvedValue(role);

      const result = await service.findOne(role.id, ORG_ID);

      expect(result).toEqual(role);
    });

    it('throws NotFoundException when role does not exist', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('bad-id', ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new org role without permissions when permissionIds is empty', async () => {
      const dto = { name: 'New Role', description: 'Test role' };
      const role = makeRole({ name: dto.name, description: dto.description });

      rolesRepo.findOne.mockResolvedValue(null); // no duplicate
      rolesRepo.create.mockReturnValue(role);
      rolesRepo.save.mockResolvedValue(role);

      const result = await service.create(dto, ORG_ID);

      expect(rolesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: dto.name,
          scope: RoleScope.ORG,
          isSystem: false,
          orgId: ORG_ID,
          permissions: [],
        }),
      );
      expect(result).toEqual(role);
    });

    it('resolves and attaches permissions when permissionIds are provided', async () => {
      const perm = makePermission();
      const dto = { name: 'Role With Perms', permissionIds: [perm.id] };
      const role = makeRole({ name: dto.name, permissions: [perm] });

      rolesRepo.findOne.mockResolvedValue(null);
      permissionsRepo.findBy.mockResolvedValue([perm]);
      rolesRepo.create.mockReturnValue(role);
      rolesRepo.save.mockResolvedValue(role);

      const result = await service.create(dto, ORG_ID);

      expect(permissionsRepo.findBy).toHaveBeenCalled();
      expect(result.permissions).toContain(perm);
    });

    it('throws ConflictException when a role with that name already exists in the org', async () => {
      const dto = { name: 'Existing Role' };
      rolesRepo.findOne.mockResolvedValue(makeRole({ name: dto.name }));

      await expect(service.create(dto, ORG_ID)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when a permissionId does not exist', async () => {
      const dto = { name: 'New Role', permissionIds: ['missing-perm-uuid'] };

      rolesRepo.findOne.mockResolvedValue(null);
      permissionsRepo.findBy.mockResolvedValue([]); // none found

      await expect(service.create(dto, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates name and description of a custom org role', async () => {
      const role = makeRole();
      const dto = { name: 'Updated Name', description: 'Updated desc' };
      const updated = { ...role, ...dto };

      rolesRepo.findOne.mockResolvedValue(role);
      rolesRepo.save.mockResolvedValue(updated);

      const result = await service.update(role.id, dto, ORG_ID);

      expect(rolesRepo.save).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('throws ForbiddenException when trying to update a system role', async () => {
      const systemRole = makeSystemRole();
      rolesRepo.findOne.mockResolvedValue(systemRole);

      await expect(service.update(systemRole.id, { name: 'Hack' }, ORG_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when renaming to a name that already exists in the org', async () => {
      const role = makeRole({ name: 'Original' });
      const conflicting = makeRole({ id: 'role-uuid-2', name: 'Taken' });

      // First call: findOne to get the role being updated
      // Second call: findOne to check for duplicate name
      rolesRepo.findOne
        .mockResolvedValueOnce(role)
        .mockResolvedValueOnce(conflicting);

      await expect(service.update(role.id, { name: 'Taken' }, ORG_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when role does not exist', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      await expect(service.update('bad-id', { name: 'X' }, ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a custom org role that has no assigned users', async () => {
      const role = makeRole();

      rolesRepo.findOne.mockResolvedValue(role);
      uorRepo.countBy.mockResolvedValue(0);
      rolesRepo.remove.mockResolvedValue(undefined as any);

      await service.remove(role.id, ORG_ID);

      expect(rolesRepo.remove).toHaveBeenCalledWith(role);
    });

    it('throws ForbiddenException when trying to delete a system role', async () => {
      const systemRole = makeSystemRole();
      rolesRepo.findOne.mockResolvedValue(systemRole);

      await expect(service.remove(systemRole.id, ORG_ID)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the role is still assigned to users', async () => {
      const role = makeRole();

      rolesRepo.findOne.mockResolvedValue(role);
      uorRepo.countBy.mockResolvedValue(3); // 3 users have this role

      await expect(service.remove(role.id, ORG_ID)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when role does not exist', async () => {
      rolesRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('bad-id', ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignPermissions ────────────────────────────────────────────────────

  describe('assignPermissions', () => {
    it('replaces all permissions on the role', async () => {
      const role = makeRole();
      const perm1 = makePermission({ id: 'perm-1' });
      const perm2 = makePermission({ id: 'perm-2', action: PermissionAction.WRITE });
      const dto = { permissionIds: [perm1.id, perm2.id] };

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([perm1, perm2]);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm1, perm2] });

      const result = await service.assignPermissions(role.id, dto, ORG_ID);

      expect(role.permissions).toEqual([perm1, perm2]);
      expect(rolesRepo.save).toHaveBeenCalledWith(role);
      expect(result.permissions).toHaveLength(2);
    });

    it('throws ForbiddenException when trying to manage permissions on a system role', async () => {
      const systemRole = makeSystemRole();
      rolesRepo.findOne.mockResolvedValue(systemRole);

      await expect(
        service.assignPermissions(systemRole.id, { permissionIds: ['p1'] }, ORG_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when a permissionId does not exist', async () => {
      const role = makeRole();
      const dto = { permissionIds: ['missing-uuid'] };

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([]);

      await expect(service.assignPermissions(role.id, dto, ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── removePermission ─────────────────────────────────────────────────────

  describe('removePermission', () => {
    it('filters out the specified permission and saves', async () => {
      const perm1 = makePermission({ id: 'perm-1' });
      const perm2 = makePermission({ id: 'perm-2', action: PermissionAction.WRITE });
      const role = makeRole({ permissions: [perm1, perm2] });

      rolesRepo.findOne.mockResolvedValue(role);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm2] });

      const result = await service.removePermission(role.id, perm1.id, ORG_ID);

      expect(role.permissions).not.toContain(perm1);
      expect(rolesRepo.save).toHaveBeenCalledWith(role);
      expect(result.permissions).toEqual([perm2]);
    });

    it('throws ForbiddenException when trying to remove permissions from a system role', async () => {
      const systemRole = makeSystemRole({ permissions: [makePermission()] });
      rolesRepo.findOne.mockResolvedValue(systemRole);

      await expect(
        service.removePermission(systemRole.id, 'perm-1', ORG_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
