import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import Redis from 'ioredis';
import { User } from './entities/user.entity';
import { AssignOrgDto } from './dto/assign-org.dto';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { Role } from '../roles/entities/role.entity';
import { KafkaProducerService, TOPICS, getClientIp } from '@sgd/common';
import { userDisplayName, encodeCursor, decodeCursor } from './user.helpers';

@Injectable()
export class UserOrgService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  private async invalidatePermissionCache(userId: string, orgId: string): Promise<void> {
    await this.redis.del(`perms:${userId}:${orgId}`).catch(() => {});
    this.kafkaProducer.emitSafe(TOPICS.USER_PERMISSIONS_CHANGED, { userId, orgId });
  }

  private emitAuditLog(params: {
    actorId?: string;
    orgId?: string;
    action: string;
    resourceId: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  }): void {
    if (!params.actorId) return;
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:      'user-service',
      actorId:      params.actorId,
      orgId:        params.orgId ?? null,
      action:       params.action,
      resourceType: 'user',
      resourceId:   params.resourceId,
      resourceName: params.resourceName ?? null,
      ip:           getClientIp(),
      metadata:     params.metadata ?? null,
      timestamp:    new Date().toISOString(),
    });
  }

  private async findUser(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async getCompanies(userId: string): Promise<string[]> {
    const rows = await this.userOrgRoleRepository.find({
      where: { userId, roleId: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });

    const seen = new Set<string>();
    const orgIds: string[] = [];
    for (const row of rows) {
      if (!seen.has(row.orgId)) {
        seen.add(row.orgId);
        orgIds.push(row.orgId);
      }
    }
    return orgIds;
  }

  async assignOrg(userId: string, dto: AssignOrgDto, assignedBy: string): Promise<UserOrgRole> {
    const targetUser = await this.findUser(userId);
    const roleId = dto.roleId ?? null;

    // Validate roleId before either branch can write a dangling FK reference.
    // Fetching here also lets both branches reuse the role name in audit logs.
    const newRole = roleId
      ? await this.roleRepository.findOne({ where: { id: roleId } })
      : null;
    if (roleId && !newRole) throw new NotFoundException(`Role ${roleId} not found`);

    const existing = await this.userOrgRoleRepository.findOne({
      where: { userId, orgId: dto.orgId },
    });

    if (existing) {
      if (existing.roleId === roleId && existing.removedAt === null) {
        throw new ConflictException('User already has this role in this org');
      }
      const oldRole = existing.roleId
        ? await this.roleRepository.findOne({ where: { id: existing.roleId } })
        : null;
      await this.userOrgRoleRepository.update(existing.id, { roleId, assignedBy, removedAt: null });
      this.emitAuditLog({
        actorId:      assignedBy,
        orgId:        dto.orgId,
        action:       'USER_ORG_ROLE_UPDATED',
        resourceId:   userId,
        resourceName: userDisplayName(targetUser),
        metadata:     { changes: { role: { from: oldRole?.name ?? null, to: newRole?.name ?? null } } },
      });
      await this.invalidatePermissionCache(userId, dto.orgId);
      return this.userOrgRoleRepository.findOne({
        where: { id: existing.id },
        relations: ['role'],
      }) as Promise<UserOrgRole>;
    }

    const record = this.userOrgRoleRepository.create({ userId, orgId: dto.orgId, roleId, assignedBy });
    const saved = await this.userOrgRoleRepository.save(record);
    this.emitAuditLog({
      actorId:      assignedBy,
      orgId:        dto.orgId,
      action:       'USER_ORG_ASSIGNED',
      resourceId:   userId,
      resourceName: userDisplayName(targetUser),
      metadata:     { orgId: dto.orgId, roleId },
    });
    await this.invalidatePermissionCache(userId, dto.orgId);
    return saved;
  }

  async findByOrg(
    orgId: string,
    limit = 100,
    cursor?: string,
  ): Promise<{
    data: { user: User; roles: { roleId: string; roleName: string }[]; orgRemovedAt: Date | null; isOptionalReviewer: boolean }[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const qb = this.userOrgRoleRepository
      .createQueryBuilder('uor')
      .innerJoinAndSelect('uor.user', 'user')
      .leftJoinAndSelect('uor.role', 'role')
      .where('uor.orgId = :orgId', { orgId })
      .withDeleted()
      .orderBy('user.createdAt', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .take(safeLimit + 1);

    if (decoded) {
      qb.andWhere(
        '(user.createdAt > :at OR (user.createdAt = :at AND user.id > :cursorId))',
        { at: decoded.at, cursorId: decoded.id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

    const data = pageRows.map((r) => ({
      user: r.user,
      roles: r.roleId && r.role ? [{ roleId: r.roleId, roleName: r.role.name }] : [],
      orgRemovedAt: r.removedAt,
      isOptionalReviewer: r.isOptionalReviewer,
    }));

    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.user.createdAt, last.user.id) : null;

    return { data, nextCursor, hasMore };
  }

  async removeRoleFromOrg(userId: string, orgId: string, roleId: string, actorId?: string): Promise<void> {
    const targetUser = await this.findUser(userId);
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);

    const result = await this.userOrgRoleRepository.update(
      { userId, orgId, roleId },
      { roleId: null, assignedBy: null },
    );
    if ((result.affected ?? 0) === 0) {
      throw new NotFoundException(`User ${userId} does not have role ${roleId} in org ${orgId}`);
    }

    await this.invalidatePermissionCache(userId, orgId);

    if (actorId) {
      this.emitAuditLog({
        actorId,
        orgId,
        action:       'USER_ORG_ROLE_UPDATED',
        resourceId:   userId,
        resourceName: userDisplayName(targetUser),
        metadata:     { changes: { role: { from: role.name, to: null } } },
      });
    }
  }

  async removeFromOrg(userId: string, orgId: string, actorId?: string): Promise<void> {
    const targetUser = await this.findUser(userId);
    const result = await this.userOrgRoleRepository.update(
      { userId, orgId },
      { roleId: null, assignedBy: null, removedAt: new Date() },
    );
    if ((result.affected ?? 0) === 0) {
      throw new NotFoundException(`User ${userId} is not assigned to org ${orgId}`);
    }

    this.kafkaProducer.emitSafe(TOPICS.USER_ORG_REMOVED, { userId, orgId });
    await this.invalidatePermissionCache(userId, orgId);

    if (actorId) {
      this.emitAuditLog({
        actorId,
        orgId,
        action:       'USER_REMOVED_FROM_ORG',
        resourceId:   userId,
        resourceName: userDisplayName(targetUser),
        metadata:     { orgId },
      });
    }
  }

  async removeAllFromOrg(orgId: string): Promise<void> {
    const affected = await this.userOrgRoleRepository.find({
      where: { orgId, removedAt: IsNull() },
      select: { userId: true },
    });

    await this.userOrgRoleRepository
      .createQueryBuilder()
      .update(UserOrgRole)
      .set({
        roleId:     null,
        assignedBy: null,
        removedAt:  () => 'COALESCE(removed_at, NOW())',
      })
      .where('org_id = :orgId', { orgId })
      .andWhere('removed_at IS NULL')
      .execute();

    await Promise.allSettled(
      affected.map((uor) => this.invalidatePermissionCache(uor.userId, orgId)),
    );
  }

  async getOrgRoles(userId: string): Promise<UserOrgRole[]> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return this.userOrgRoleRepository.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async getMyOrgRoles(userId: string, orgId: string): Promise<UserOrgRole[]> {
    return this.userOrgRoleRepository.find({
      where: { userId, orgId, roleId: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });
  }

  async getEffectivePermissions(
    userId: string,
    orgId: string,
  ): Promise<{ module: string; action: string }[]> {
    const userOrgRoles = await this.userOrgRoleRepository
      .createQueryBuilder('uor')
      .innerJoinAndSelect('uor.role', 'r')
      .leftJoinAndSelect('r.permissions', 'p')
      .where('uor.userId = :userId', { userId })
      .andWhere('uor.orgId = :orgId', { orgId })
      .andWhere('uor.roleId IS NOT NULL')
      .getMany();

    const seen = new Set<string>();
    const permissions: { module: string; action: string }[] = [];

    for (const uor of userOrgRoles) {
      for (const p of uor.role?.permissions ?? []) {
        const key = `${p.module}:${p.action}`;
        if (!seen.has(key)) {
          seen.add(key);
          permissions.push({ module: p.module as string, action: p.action as string });
        }
      }
    }

    return permissions;
  }

  async setOptionalReviewer(
    userId: string,
    orgId: string,
    value: boolean,
    actorId?: string,
  ): Promise<void> {
    const existing = await this.userOrgRoleRepository.findOne({
      where: { userId, orgId, removedAt: IsNull() },
    });
    if (!existing) {
      throw new NotFoundException(`User ${userId} is not a member of org ${orgId}`);
    }
    const previousValue = existing.isOptionalReviewer;
    await this.userOrgRoleRepository.update(
      { userId, orgId, removedAt: IsNull() },
      { isOptionalReviewer: value },
    );
    if (actorId) {
      const user = await this.findUser(userId);
      this.emitAuditLog({
        actorId,
        orgId,
        action:       'USER_OPTIONAL_REVIEWER_CHANGED',
        resourceId:   userId,
        resourceName: userDisplayName(user),
        metadata:     { changes: { isOptionalReviewer: { from: previousValue, to: value } } },
      });
    }
  }
}
