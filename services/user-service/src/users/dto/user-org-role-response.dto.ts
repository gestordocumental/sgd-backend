import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';

export class UserOrgRoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  roleId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  assignedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
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
