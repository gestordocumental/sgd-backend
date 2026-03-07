import { ForbiddenException } from '@nestjs/common';
import { Role } from '../entities/role.entity';

export class RolePolicy {
  static canModify(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException('System roles cannot be modified');
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot modify roles from another organization');
  }

  static canDelete(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException('System roles cannot be deleted');
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot delete roles from another organization');
  }

  static canManagePermissions(role: Role, orgId: string): void {
    if (role.isSystem)
      throw new ForbiddenException('System role permissions cannot be modified');
    if (role.orgId !== orgId)
      throw new ForbiddenException('Cannot modify roles from another organization');
  }
}
