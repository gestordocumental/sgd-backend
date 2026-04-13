import { ApiProperty } from '@nestjs/swagger';
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

  static fromUserAndRoles(
    user: User,
    roles: { roleId: string; roleName: string }[],
  ): UserWithOrgRolesDto {
    const dto = Object.assign(new UserWithOrgRolesDto(), UserResponseDto.from(user));
    dto.roles = roles;
    return dto;
  }
}
