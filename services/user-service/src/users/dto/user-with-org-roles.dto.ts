import { User } from '../entities/user.entity';
import { UserResponseDto } from './user-response.dto';

export class UserWithOrgRolesDto extends UserResponseDto {
  roles!: { roleId: string; roleName: string }[];

  static fromUserAndRoles(
    user: User,
    roles: { roleId: string; roleName: string }[],
  ): UserWithOrgRolesDto {
    const dto = Object.assign(new UserWithOrgRolesDto(), UserResponseDto.from(user));
    dto.roles = roles;
    return dto;
  }
}
