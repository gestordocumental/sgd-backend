import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { RolePolicy } from './role.policy';
import { Role, RoleScope } from '../entities/role.entity';
import { Permission, PermissionModule, PermissionAction } from '../entities/permission.entity';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-1';

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

const makePermission = (overrides: Partial<Permission> = {}): Permission => ({
  id: 'perm-uuid-1',
  module: PermissionModule.DOCUMENTS,
  action: PermissionAction.READ,
  description: null,
  roles: [],
  ...overrides,
});

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('RolePolicy', () => {
  // ─── canModify ────────────────────────────────────────────────────────────

  describe('canModify', () => {
    it('allows modifying a custom org role that belongs to the caller org', () => {
      const role = makeRole();
      expect(() => RolePolicy.canModify(role, ORG_ID)).not.toThrow();
    });

    it('throws ForbiddenException when the role is a system role', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canModify(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the role belongs to a different org', () => {
      const role = makeRole({ orgId: 'other-org' });
      expect(() => RolePolicy.canModify(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('includes a descriptive message when blocking a system role modification', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canModify(role, ORG_ID)).toThrow('System roles cannot be modified');
    });

    it('includes the SYSTEM_ROLE_NOT_MODIFIABLE errorCode when blocking a system role modification', () => {
      const role = makeRole({ isSystem: true });
      try {
        RolePolicy.canModify(role, ORG_ID);
        fail('expected RolePolicy.canModify to throw');
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          errorCode: 'SYSTEM_ROLE_NOT_MODIFIABLE',
        });
      }
    });
  });

  // ─── canDelete ────────────────────────────────────────────────────────────

  describe('canDelete', () => {
    it('allows deleting a custom org role that belongs to the caller org', () => {
      const role = makeRole();
      expect(() => RolePolicy.canDelete(role, ORG_ID)).not.toThrow();
    });

    it('throws ForbiddenException when the role is a system role', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canDelete(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the role belongs to a different org', () => {
      const role = makeRole({ orgId: 'other-org' });
      expect(() => RolePolicy.canDelete(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('includes a descriptive message when blocking a system role deletion', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canDelete(role, ORG_ID)).toThrow('System roles cannot be deleted');
    });

    it('includes the SYSTEM_ROLE_NOT_DELETABLE errorCode when blocking a system role deletion', () => {
      const role = makeRole({ isSystem: true });
      try {
        RolePolicy.canDelete(role, ORG_ID);
        fail('expected RolePolicy.canDelete to throw');
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          errorCode: 'SYSTEM_ROLE_NOT_DELETABLE',
        });
      }
    });
  });

  // ─── canManagePermissions ─────────────────────────────────────────────────

  describe('canManagePermissions', () => {
    it('allows managing permissions for a custom org role', () => {
      const role = makeRole();
      expect(() => RolePolicy.canManagePermissions(role, ORG_ID)).not.toThrow();
    });

    it('throws ForbiddenException when the role is a system role', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canManagePermissions(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the role belongs to a different org', () => {
      const role = makeRole({ orgId: 'other-org' });
      expect(() => RolePolicy.canManagePermissions(role, ORG_ID)).toThrow(ForbiddenException);
    });

    it('includes a descriptive message when blocking system role permission management', () => {
      const role = makeRole({ isSystem: true });
      expect(() => RolePolicy.canManagePermissions(role, ORG_ID)).toThrow(
        'System role permissions cannot be modified',
      );
    });

    it('includes the SYSTEM_ROLE_NOT_MODIFIABLE errorCode when blocking system role permission management', () => {
      const role = makeRole({ isSystem: true });
      try {
        RolePolicy.canManagePermissions(role, ORG_ID);
        fail('expected RolePolicy.canManagePermissions to throw');
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          errorCode: 'SYSTEM_ROLE_NOT_MODIFIABLE',
        });
      }
    });
  });

  // ─── validatePermissionSet ────────────────────────────────────────────────

  describe('validatePermissionSet', () => {
    it('allows an empty permission set', () => {
      expect(() => RolePolicy.validatePermissionSet([])).not.toThrow();
    });

    it('allows a module with only READ', () => {
      const permissions = [makePermission({ action: PermissionAction.READ })];
      expect(() => RolePolicy.validatePermissionSet(permissions)).not.toThrow();
    });

    it('allows a module with READ plus action permissions', () => {
      const permissions = [
        makePermission({ id: 'p1', action: PermissionAction.READ }),
        makePermission({ id: 'p2', action: PermissionAction.WRITE }),
        makePermission({ id: 'p3', action: PermissionAction.DELETE }),
      ];
      expect(() => RolePolicy.validatePermissionSet(permissions)).not.toThrow();
    });

    it('allows independent modules that each carry their own READ', () => {
      const permissions = [
        makePermission({ id: 'p1', module: PermissionModule.DOCUMENTS, action: PermissionAction.READ }),
        makePermission({ id: 'p2', module: PermissionModule.WORKFLOWS, action: PermissionAction.READ }),
        makePermission({ id: 'p3', module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE }),
      ];
      expect(() => RolePolicy.validatePermissionSet(permissions)).not.toThrow();
    });

    it('throws BadRequestException when a module has an action permission but no READ', () => {
      const permissions = [makePermission({ action: PermissionAction.WRITE })];
      expect(() => RolePolicy.validatePermissionSet(permissions)).toThrow(BadRequestException);
    });

    it('throws when one module is missing READ even if another module is correctly configured', () => {
      const permissions = [
        makePermission({ id: 'p1', module: PermissionModule.DOCUMENTS, action: PermissionAction.READ }),
        makePermission({ id: 'p2', module: PermissionModule.DOCUMENTS, action: PermissionAction.WRITE }),
        makePermission({ id: 'p3', module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE }),
      ];
      try {
        RolePolicy.validatePermissionSet(permissions);
        fail('expected RolePolicy.validatePermissionSet to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({
          errorCode: 'MODULE_ACTION_PERMISSION_REQUIRES_READ',
          params: { modules: [PermissionModule.WORKFLOWS] },
        });
      }
    });

    it('includes every offending module in the error params', () => {
      const permissions = [
        makePermission({ id: 'p1', module: PermissionModule.DOCUMENTS, action: PermissionAction.WRITE }),
        makePermission({ id: 'p2', module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE }),
      ];
      try {
        RolePolicy.validatePermissionSet(permissions);
        fail('expected RolePolicy.validatePermissionSet to throw');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({
          params: { modules: expect.arrayContaining([PermissionModule.DOCUMENTS, PermissionModule.WORKFLOWS]) },
        });
      }
    });
  });
});
