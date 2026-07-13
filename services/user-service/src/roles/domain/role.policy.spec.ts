import { ForbiddenException } from '@nestjs/common';
import { RolePolicy } from './role.policy';
import { Role, RoleScope } from '../entities/role.entity';

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
});
