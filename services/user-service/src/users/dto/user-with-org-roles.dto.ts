import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { UserResponseDto } from './user-response.dto';

class UserRoleSummaryDto {
  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty()
  roleName!: string;
}

export class UserWithOrgRolesDto extends UserResponseDto {
  @ApiProperty({ type: [UserRoleSummaryDto] })
  roles!: UserRoleSummaryDto[];

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  orgRemovedAt!: Date | null;

  /** True when this user is an optional reviewer specifically in this org. */
  @ApiProperty({ description: 'Optional reviewer flag for this organization only' })
  isOptionalReviewer!: boolean;

  static fromUserAndRoles(
    user: User,
    roles: { roleId: string; roleName: string }[],
    orgRemovedAt: Date | null,
    isOptionalReviewer: boolean,
  ): UserWithOrgRolesDto {
    const dto = Object.assign(new UserWithOrgRolesDto(), UserResponseDto.from(user));
    dto.roles = roles;
    dto.orgRemovedAt = orgRemovedAt;
    dto.isOptionalReviewer = isOptionalReviewer;
    return dto;
  }
}
