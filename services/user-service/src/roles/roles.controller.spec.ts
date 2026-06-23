import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Role, RoleScope } from './entities/role.entity';
import { Permission, PermissionModule, PermissionAction } from './entities/permission.entity';

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

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('RolesController', () => {
  let controller: RolesController;
  let rolesService: jest.Mocked<RolesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        {
          provide: RolesService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            assignPermissions: jest.fn(),
            removePermission: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(RolesController);
    rolesService = module.get(RolesService);
  });

  // ─── GET / ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('delegates to rolesService.findAll with the orgId', async () => {
      const roles = [makeRole()];
      rolesService.findAll.mockResolvedValue(roles);

      const result = await controller.findAll(ORG_ID);

      expect(rolesService.findAll).toHaveBeenCalledWith(ORG_ID);
      expect(result).toEqual(roles);
    });
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('delegates to rolesService.findOne with id and orgId', async () => {
      const role = makeRole();
      rolesService.findOne.mockResolvedValue(role);

      const result = await controller.findOne(role.id, ORG_ID);

      expect(rolesService.findOne).toHaveBeenCalledWith(role.id, ORG_ID);
      expect(result).toEqual(role);
    });
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to rolesService.create with dto and orgId', async () => {
      const dto = { name: 'New Role', description: 'A custom role' };
      const role = makeRole(dto);

      rolesService.create.mockResolvedValue(role);

      const result = await controller.create(dto as any, ORG_ID);

      expect(rolesService.create).toHaveBeenCalledWith(dto, ORG_ID);
      expect(result).toEqual(role);
    });
  });

  // ─── PATCH /:id ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('delegates to rolesService.update with id, dto and orgId', async () => {
      const role = makeRole();
      const dto = { name: 'Updated Role' };
      const updated = { ...role, ...dto };

      rolesService.update.mockResolvedValue(updated);

      const result = await controller.update(role.id, dto as any, ORG_ID);

      expect(rolesService.update).toHaveBeenCalledWith(role.id, dto, ORG_ID);
      expect(result).toEqual(updated);
    });
  });

  // ─── DELETE /:id ──────────────────────────────────────────────────────────

  describe('remove', () => {
    it('delegates to rolesService.remove with id and orgId', async () => {
      rolesService.remove.mockResolvedValue(undefined);

      await controller.remove('role-uuid-1', ORG_ID);

      expect(rolesService.remove).toHaveBeenCalledWith('role-uuid-1', ORG_ID);
    });
  });

  // ─── POST /:id/permissions ────────────────────────────────────────────────

  describe('assignPermissions', () => {
    it('delegates to rolesService.assignPermissions and returns the updated role', async () => {
      const perm = makePermission();
      const role = makeRole({ permissions: [perm] });
      const dto = { permissionIds: [perm.id] };

      rolesService.assignPermissions.mockResolvedValue(role);

      const result = await controller.assignPermissions(role.id, dto as any, ORG_ID);

      expect(rolesService.assignPermissions).toHaveBeenCalledWith(role.id, dto, ORG_ID);
      expect(result).toEqual(role);
    });
  });

  // ─── DELETE /:id/permissions/:permissionId ────────────────────────────────

  describe('removePermission', () => {
    it('delegates to rolesService.removePermission and returns the updated role', async () => {
      const role = makeRole();
      rolesService.removePermission.mockResolvedValue(role);

      const result = await controller.removePermission(role.id, 'perm-uuid-1', ORG_ID);

      expect(rolesService.removePermission).toHaveBeenCalledWith(role.id, 'perm-uuid-1', ORG_ID);
      expect(result).toEqual(role);
    });
  });
});
