import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '../entities/role.entity';
import { Permission, PermissionAction } from '../entities/permission.entity';

export class RolePolicy {
  static canModify(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException({
        message: 'System roles cannot be modified',
        errorCode: 'SYSTEM_ROLE_NOT_MODIFIABLE',
      });
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot modify roles from another organization');
  }

  static canDelete(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException({
        message: 'System roles cannot be deleted',
        errorCode: 'SYSTEM_ROLE_NOT_DELETABLE',
      });
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot manage permissions for roles from another organization');
  }

  static canManagePermissions(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException({
        message: 'System role permissions cannot be modified',
        errorCode: 'SYSTEM_ROLE_NOT_MODIFIABLE',
      });
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot modify roles from another organization');
  }

  /**
   * Every action permission (WRITE, DELETE, APPROVE, UPLOAD, DOWNLOAD,
   * MANAGE) on a module is useless without READ ("Ver") for that same
   * module — the user could never reach the screen that exposes the action
   * in the first place. Enforced here so it holds regardless of entry point
   * (create a role with permissions already attached, replace a role's full
   * permission set, or remove a single permission — e.g. removing READ
   * while WORKFLOWS:APPROVE is still assigned would silently produce the
   * same unusable configuration this method exists to prevent).
   */
  static validatePermissionSet(permissions: Permission[]): void {
    const modulesNeedingRead = new Set(
      permissions.filter((p) => p.action !== PermissionAction.READ).map((p) => p.module),
    );
    const modulesWithRead = new Set(
      permissions.filter((p) => p.action === PermissionAction.READ).map((p) => p.module),
    );
    const missingRead = [...modulesNeedingRead].filter((m) => !modulesWithRead.has(m));

    if (missingRead.length > 0) {
      throw new BadRequestException({
        message: `Cannot grant action permissions for module(s) ${missingRead.join(', ')} without also granting View (READ) for the same module(s)`,
        errorCode: 'MODULE_ACTION_PERMISSION_REQUIRES_READ',
        params: { modules: missingRead },
      });
    }
  }
}
