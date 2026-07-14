import { ForbiddenException } from '@nestjs/common';
import { Role } from '../entities/role.entity';

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
}
