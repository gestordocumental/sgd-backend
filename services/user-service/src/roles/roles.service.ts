import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import type { Redis } from 'ioredis';
import { KafkaProducerService, TOPICS } from '@sgd/common';
import { Role, RoleScope } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { RolePolicy } from './domain/role.policy';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Invalidates the cached effective-permissions for every user currently
   * holding this role, and emits USER_PERMISSIONS_CHANGED per user so the
   * notification-service can push a live SSE update — without this, a user
   * with an active session keeps their old permission set (from the Redis
   * cache and/or their JWT) until the cache TTL expires or they log back in.
   */
  private async notifyPermissionsChanged(roleId: string, orgId: string): Promise<void> {
    const affected = await this.userOrgRoleRepository.find({
      where: { roleId, orgId, removedAt: IsNull() },
      select: { userId: true },
    });
    const userIds = [...new Set(affected.map((r) => r.userId))];

    await Promise.all(
      userIds.map((userId) => this.redis.del(`perms:${userId}:${orgId}`).catch(() => {})),
    );
    for (const userId of userIds) {
      this.kafkaProducer.emitSafe(TOPICS.USER_PERMISSIONS_CHANGED, { userId, orgId });
    }
  }

  // Returns system roles + custom roles for the given org
  findAll(orgId: string): Promise<Role[]> {
    return this.rolesRepository.find({
      where: [{ orgId: IsNull() }, { orgId }],
      relations: ['permissions'],
      order: { isSystem: 'DESC', name: 'ASC' },
    });
  }

  async findOne(id: string, orgId: string): Promise<Role> {
    const role = await this.rolesRepository.findOne({
      where: [{ id, orgId: IsNull() }, { id, orgId }],
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async create(dto: CreateRoleDto, orgId: string): Promise<Role> {
    const existing = await this.rolesRepository.findOne({
      where: { name: dto.name, orgId },
    });
    if (existing) throw new ConflictException(`Role "${dto.name}" already exists in this organization`);

    const permissions = dto.permissionIds?.length
      ? await this.resolvePermissions(dto.permissionIds)
      : [];

    const role = this.rolesRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      scope: RoleScope.ORG,
      isSystem: false,
      orgId,
      permissions,
    });

    return this.rolesRepository.save(role);
  }

  async update(id: string, dto: UpdateRoleDto, orgId: string): Promise<Role> {
    const role = await this.findOne(id, orgId);
    RolePolicy.canModify(role, orgId);

    if (dto.name && dto.name !== role.name){
      const existing = await this.rolesRepository.findOne({
        where: {name: dto.name, orgId}
      });
      if (existing && existing.id !== role.id){
        throw new ConflictException(`Role "${dto.name}" already exists in this organization`);
      }
    }

    if (dto.name) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    return this.rolesRepository.save(role);
  }

  async remove(id: string, orgId: string): Promise<void> {
    const role = await this.findOne(id, orgId);
    RolePolicy.canDelete(role, orgId);

    const assignedCount = await this.userOrgRoleRepository.countBy({ roleId: id });
    if (assignedCount > 0) {
      throw new ConflictException(
        `Role "${role.name}" is still assigned to ${assignedCount} user(s) and cannot be deleted`,
      );
    }

    await this.rolesRepository.remove(role);
  }

  async assignPermissions(id: string, dto: AssignPermissionsDto, orgId: string): Promise<Role> {
    const role = await this.findOne(id, orgId);
    RolePolicy.canManagePermissions(role, orgId);

    const permissions = await this.resolvePermissions(dto.permissionIds);

    role.permissions = permissions;
    const saved = await this.rolesRepository.save(role);
    await this.notifyPermissionsChanged(id, orgId);
    return saved;
  }

  private async resolvePermissions(permissionIds: string[]): Promise<Permission[]> {
    const uniqueIds = [...new Set(permissionIds)];
    const permissions = await this.permissionsRepository.findBy({ id: In(uniqueIds) });
    if (permissions.length !== uniqueIds.length) {
      const foundIds = new Set(permissions.map((p) => p.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Permissions not found: ${missing.join(', ')}`);
    }
    return permissions;
  }

  async removePermission(roleId: string, permissionId: string, orgId: string): Promise<Role> {
    const role = await this.findOne(roleId, orgId);
    RolePolicy.canManagePermissions(role, orgId);

    role.permissions = role.permissions.filter((p) => p.id !== permissionId);
    const saved = await this.rolesRepository.save(role);
    await this.notifyPermissionsChanged(roleId, orgId);
    return saved;
  }
}
