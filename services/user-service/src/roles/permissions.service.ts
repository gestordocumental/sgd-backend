import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepo: Repository<UserOrgRole>,
  ) {}

  // Read-only — orgs can only assign existing permissions, not create new ones
  findAll(): Promise<Permission[]> {
    return this.permissionsRepository.find({
      order: { module: 'ASC', action: 'ASC' },
    });
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
