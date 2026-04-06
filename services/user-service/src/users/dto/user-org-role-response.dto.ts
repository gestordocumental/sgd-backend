import { UserOrgRole } from '../../roles/entities/user-org-role.entity';

export class UserOrgRoleResponseDto {
  id!: string;
  userId!: string;
  orgId!: string;
  roleId!: string | null;
  assignedBy!: string | null;
  createdAt!: Date;

  static from(uor: UserOrgRole): UserOrgRoleResponseDto {
    const dto = new UserOrgRoleResponseDto();
    dto.id = uor.id;
    dto.userId = uor.userId;
    dto.orgId = uor.orgId;
    dto.roleId = uor.roleId;
    dto.assignedBy = uor.assignedBy;
    dto.createdAt = uor.createdAt;
    return dto;
  }
}
