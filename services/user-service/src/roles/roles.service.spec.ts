import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { KafkaProducerService } from '@sgd/common';
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
  let redis: { del: jest.Mock };
  let kafkaProducer: { emitSafe: jest.Mock };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    redis = { del: jest.fn().mockResolvedValue(1) };
    kafkaProducer = { emitSafe: jest.fn() };

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
          useValue: { countBy: jest.fn(), find: jest.fn().mockResolvedValue([]) },
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: KafkaProducerService, useValue: kafkaProducer },
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

    it('throws BadRequestException when creating a role with an action permission but no READ for the same module', async () => {
      const writePerm = makePermission({ id: 'perm-write', action: PermissionAction.WRITE });
      const dto = { name: 'Broken Role', permissionIds: [writePerm.id] };

      rolesRepo.findOne.mockResolvedValue(null);
      permissionsRepo.findBy.mockResolvedValue([writePerm]);

      await expect(service.create(dto, ORG_ID)).rejects.toThrow(BadRequestException);
      expect(rolesRepo.save).not.toHaveBeenCalled();
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

    it('throws ConflictException when the role is still assigned to users, with an errorCode + params the frontend can translate', async () => {
      const role = makeRole();

      rolesRepo.findOne.mockResolvedValue(role);
      uorRepo.countBy.mockResolvedValue(3); // 3 users have this role

      try {
        await service.remove(role.id, ORG_ID);
        fail('expected remove() to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toEqual({
          message: `Role "${role.name}" is still assigned to 3 user(s) and cannot be deleted`,
          errorCode: 'ROLE_HAS_ASSIGNED_USERS',
          params: { name: role.name, count: 3 },
        });
      }
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

    it('throws BadRequestException when replacing the permission set with an action permission but no READ for the same module', async () => {
      const role = makeRole();
      const approvePerm = makePermission({
        id: 'perm-approve',
        module: PermissionModule.WORKFLOWS,
        action: PermissionAction.APPROVE,
      });
      const dto = { permissionIds: [approvePerm.id] };

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([approvePerm]);

      await expect(service.assignPermissions(role.id, dto, ORG_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(rolesRepo.save).not.toHaveBeenCalled();
    });

    it('invalidates the permission cache and emits USER_PERMISSIONS_CHANGED for every currently-assigned user', async () => {
      const role = makeRole();
      const perm = makePermission();
      const dto = { permissionIds: [perm.id] };

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([perm]);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm] });
      uorRepo.find.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-1' }, // duplicate (e.g. multiple assignments) must be deduped
      ] as UserOrgRole[]);

      await service.assignPermissions(role.id, dto, ORG_ID);

      expect(uorRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { roleId: role.id, orgId: ORG_ID, removedAt: expect.anything() } }),
      );
      expect(redis.del).toHaveBeenCalledWith(`perms:user-1:${ORG_ID}`);
      expect(redis.del).toHaveBeenCalledWith(`perms:user-2:${ORG_ID}`);
      expect(redis.del).toHaveBeenCalledTimes(2);
      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith('user.permissions-changed', {
        userId: 'user-1',
        orgId: ORG_ID,
      });
      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith('user.permissions-changed', {
        userId: 'user-2',
        orgId: ORG_ID,
      });
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2);
    });

    it('does not notify anyone when no user currently holds the role', async () => {
      const role = makeRole();
      const perm = makePermission();

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([perm]);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm] });
      uorRepo.find.mockResolvedValue([]);

      await service.assignPermissions(role.id, { permissionIds: [perm.id] }, ORG_ID);

      expect(redis.del).not.toHaveBeenCalled();
      expect(kafkaProducer.emitSafe).not.toHaveBeenCalled();
    });

    it('still resolves with the saved role when the best-effort notification lookup fails', async () => {
      // Regression: the role's permissions are already saved by the time
      // notifyPermissionsChanged runs — a transient failure in that best-effort
      // step (e.g. the UserOrgRole lookup rejecting) must not make the whole
      // assignPermissions() call reject and hide the fact that the save succeeded.
      const role = makeRole();
      const perm = makePermission();
      const saved = { ...role, permissions: [perm] };

      rolesRepo.findOne.mockResolvedValue(role);
      permissionsRepo.findBy.mockResolvedValue([perm]);
      rolesRepo.save.mockResolvedValue(saved);
      uorRepo.find.mockRejectedValue(new Error('connection lost'));

      const result = await service.assignPermissions(role.id, { permissionIds: [perm.id] }, ORG_ID);

      expect(result).toEqual(saved);
      expect(kafkaProducer.emitSafe).not.toHaveBeenCalled();
    });
  });

  // ─── removePermission ─────────────────────────────────────────────────────

  describe('removePermission', () => {
    it('filters out the specified permission and saves', async () => {
      // perm1 stays (READ) so the remaining set is still valid — removing
      // perm2 (WRITE) doesn't orphan anything.
      const perm1 = makePermission({ id: 'perm-1' });
      const perm2 = makePermission({ id: 'perm-2', action: PermissionAction.WRITE });
      const role = makeRole({ permissions: [perm1, perm2] });

      rolesRepo.findOne.mockResolvedValue(role);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm1] });

      const result = await service.removePermission(role.id, perm2.id, ORG_ID);

      expect(role.permissions).not.toContain(perm2);
      expect(rolesRepo.save).toHaveBeenCalledWith(role);
      expect(result.permissions).toEqual([perm1]);
    });

    it('throws BadRequestException when removing READ would orphan an action permission on the same module', async () => {
      // Regression: this is the exact scenario the reported bug describes —
      // removing "Ver" (READ) while an action permission (APPROVE) for the
      // same module is still assigned must be rejected, not silently allowed.
      const readPerm = makePermission({ id: 'perm-read', module: PermissionModule.WORKFLOWS });
      const approvePerm = makePermission({
        id: 'perm-approve',
        module: PermissionModule.WORKFLOWS,
        action: PermissionAction.APPROVE,
      });
      const role = makeRole({ permissions: [readPerm, approvePerm] });
      rolesRepo.findOne.mockResolvedValue(role);

      await expect(service.removePermission(role.id, readPerm.id, ORG_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(rolesRepo.save).not.toHaveBeenCalled();
      // The in-memory role.permissions must be untouched by the failed attempt.
      expect(role.permissions).toEqual([readPerm, approvePerm]);
    });

    it('throws ForbiddenException when trying to remove permissions from a system role', async () => {
      const systemRole = makeSystemRole({ permissions: [makePermission()] });
      rolesRepo.findOne.mockResolvedValue(systemRole);

      await expect(
        service.removePermission(systemRole.id, 'perm-1', ORG_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('invalidates the permission cache and emits USER_PERMISSIONS_CHANGED for every currently-assigned user', async () => {
      const perm1 = makePermission({ id: 'perm-1' });
      const perm2 = makePermission({ id: 'perm-2', action: PermissionAction.WRITE });
      const role = makeRole({ permissions: [perm1, perm2] });

      rolesRepo.findOne.mockResolvedValue(role);
      rolesRepo.save.mockResolvedValue({ ...role, permissions: [perm1] });
      uorRepo.find.mockResolvedValue([{ userId: 'user-1' }] as UserOrgRole[]);

      // Removing perm2 (WRITE) leaves perm1 (READ) — a valid remaining set.
      await service.removePermission(role.id, perm2.id, ORG_ID);

      expect(redis.del).toHaveBeenCalledWith(`perms:user-1:${ORG_ID}`);
      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith('user.permissions-changed', {
        userId: 'user-1',
        orgId: ORG_ID,
      });
    });
  });
});
