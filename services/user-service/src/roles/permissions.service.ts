import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepo: Repository<UserOrgRole>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // Read-only — orgs can only assign existing permissions, not create new ones
  findAll(): Promise<Permission[]> {
    return this.permissionsRepository.find({
      order: { module: 'ASC', action: 'ASC' },
    });
  }

  /**
   * Checks isSuperAdmin directly from the database — never from caller-supplied params.
   * This prevents privilege escalation if a calling service is compromised.
   */
  async isUserSuperAdmin(userId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['isSuperAdmin'],
    });
    return user?.isSuperAdmin === true;
  }

  async checkUserPermission(
    userId: string,
    orgId: string,
    module: string,
    action: string,
  ): Promise<boolean> {
    const userOrgRoles = await this.userOrgRoleRepo.find({
      where: { userId, orgId },
      relations: ['role', 'role.permissions'],
    });
    return userOrgRoles.some((uor) =>
      uor.role?.permissions?.some((p) => p.module === module && p.action === action) ?? false,
    );
  }
}
