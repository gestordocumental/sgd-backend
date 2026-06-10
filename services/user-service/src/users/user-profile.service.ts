import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User, RegistrationStatus } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthClientService } from '../auth-client/auth-client.service';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { KafkaProducerService, TOPICS, getClientIp } from '@sgd/common';
import { OrgClientService } from '../common/org-client/org-client.service';
import { userDisplayName, encodeCursor, decodeCursor } from './user.helpers';
import Redis from 'ioredis';

@Injectable()
export class UserProfileService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    private readonly authClientService: AuthClientService,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly orgClientService: OrgClientService,
  ) {}

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

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findManyByIds(ids: string[]): Promise<User[]> {
    if (!ids.length) return [];
    return this.usersRepository.findBy({ id: In(ids) });
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) throw new NotFoundException(`User not found`);
    return user;
  }

  async findAll(
    limit = 100,
    cursor?: string,
  ): Promise<{ data: User[]; nextCursor: string | null; hasMore: boolean }> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const qb = this.usersRepository
      .createQueryBuilder('u')
      .withDeleted()
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(safeLimit + 1);

    if (decoded) {
      qb.where(
        '(u.createdAt < :at OR (u.createdAt = :at AND u.id < :cursorId))',
        { at: decoded.at, cursorId: decoded.id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > safeLimit;
    const data = hasMore ? rows.slice(0, safeLimit) : rows;
    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return { data, nextCursor, hasMore };
  }

  async findAllSuperAdmin(
    limit = 20,
    cursor?: string,
    search?: string,
    status?: 'active' | 'inactive' | 'deleted' | 'pending',
  ): Promise<{ data: User[]; nextCursor: string | null; hasMore: boolean }> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const qb = this.usersRepository
      .createQueryBuilder('u')
      .withDeleted()
      .where('u.isSuperAdmin = :isSuperAdmin', { isSuperAdmin: true })
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(safeLimit + 1);

    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere(
        '(u.email ILIKE :q OR u.firstName ILIKE :q OR u.lastName ILIKE :q)',
        { q },
      );
    }

    if (status === 'deleted') {
      qb.andWhere('u.deletedAt IS NOT NULL');
    } else if (status === 'pending') {
      qb.andWhere('u.deletedAt IS NULL').andWhere('u.registrationStatus = :rs', { rs: 'pending_credentials' });
    } else if (status === 'active') {
      qb.andWhere('u.deletedAt IS NULL').andWhere('u.isActive = true');
    } else if (status === 'inactive') {
      qb.andWhere('u.deletedAt IS NULL')
        .andWhere('u.isActive = false')
        .andWhere('u.registrationStatus != :rs', { rs: 'pending_credentials' });
    }

    if (decoded) {
      qb.andWhere(
        '(u.createdAt < :at OR (u.createdAt = :at AND u.id < :cursorId))',
        { at: decoded.at, cursorId: decoded.id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > safeLimit;
    const data = hasMore ? rows.slice(0, safeLimit) : rows;
    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return { data, nextCursor, hasMore };
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string, orgId?: string): Promise<User> {
    const user = await this.findOne(id);

    const settingAnyOrgField =
      ('departamentoId' in dto && dto.departamentoId !== null && dto.departamentoId !== undefined) ||
      ('areaId' in dto && dto.areaId !== null && dto.areaId !== undefined) ||
      ('cargoId' in dto && dto.cargoId !== null && dto.cargoId !== undefined);

    if (settingAnyOrgField && orgId) {
      const effectiveDeptId = 'departamentoId' in dto ? dto.departamentoId : user.departamentoId;
      const effectiveAreaId = 'areaId' in dto ? dto.areaId : user.areaId;
      const effectiveCargoId = 'cargoId' in dto ? dto.cargoId : user.cargoId;

      if (effectiveDeptId === null || effectiveDeptId === undefined) {
        throw new BadRequestException('departamentoId is required when assigning an area or cargo');
      }

      await this.orgClientService.validateOrgStructure(
        orgId,
        effectiveDeptId,
        effectiveAreaId ?? undefined,
        effectiveCargoId ?? undefined,
      );
    }

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(dto)) before[key] = (user as unknown as Record<string, unknown>)[key];

    Object.assign(user, dto);
    const saved = await this.usersRepository.save(user);

    if (actorId) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(dto)) {
        const to = (dto as Record<string, unknown>)[key];
        if (before[key] !== to) changes[key] = { from: before[key], to };
      }

      if (orgId && (changes['departamentoId'] || changes['areaId'] || changes['cargoId'])) {
        const newDeptId  = saved.departamentoId;
        const newAreaId  = saved.areaId  ?? undefined;
        const newCargoId = saved.cargoId ?? undefined;
        const oldDeptId  = (before['departamentoId'] as string | undefined) ?? saved.departamentoId ?? undefined;
        const oldAreaId  = before['areaId']  as string | null | undefined;
        const oldCargoId = before['cargoId'] as string | null | undefined;

        const [toNames, fromNames] = await Promise.all([
          newDeptId ? this.orgClientService.resolveNamesById(orgId, newDeptId, newAreaId, newCargoId) : null,
          oldDeptId ? this.orgClientService.resolveNamesById(orgId, oldDeptId, oldAreaId, oldCargoId) : null,
        ]);

        if (changes['departamentoId']) {
          changes['departamentoId'] = {
            from: fromNames?.departamentoNombre ?? changes['departamentoId'].from,
            to:   toNames?.departamentoNombre   ?? changes['departamentoId'].to,
          };
        }
        if (changes['areaId']) {
          changes['areaId'] = {
            from: fromNames?.areaNombre ?? changes['areaId'].from,
            to:   toNames?.areaNombre   ?? changes['areaId'].to,
          };
        }
        if (changes['cargoId']) {
          changes['cargoId'] = {
            from: fromNames?.cargoNombre ?? changes['cargoId'].from,
            to:   toNames?.cargoNombre   ?? changes['cargoId'].to,
          };
        }
      }

      if (Object.keys(changes).length > 0) {
        this.emitAuditLog({
          actorId,
          orgId,
          action:       'USER_UPDATED',
          resourceId:   id,
          resourceName: userDisplayName(saved),
          metadata:     { changes },
        });
      }
    }
    return saved;
  }

  async uploadAvatar(userId: string, avatarUrl: string): Promise<User> {
    const user = await this.findOne(userId);
    user.avatarUrl = avatarUrl;
    return this.usersRepository.save(user);
  }

  async globalRemove(id: string, actorId?: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.softRemove(user);
    await this.authClientService.disableCredentials(user.id);
    if (actorId) {
      this.emitAuditLog({
        actorId,
        action:       'USER_DELETED',
        resourceId:   id,
        resourceName: userDisplayName(user),
      });
    }
  }

  async restore(id: string, actorId?: string): Promise<User> {
    await this.usersRepository.restore(id);
    await this.authClientService.enableCredentials(id);
    const restored = await this.findOne(id);
    this.emitAuditLog({
      actorId,
      action:       'USER_RESTORED',
      resourceId:   id,
      resourceName: userDisplayName(restored),
    });
    return restored;
  }

  async disable(
    id: string,
    caller: { actorId?: string; companyId?: string; isSuperAdmin?: boolean },
  ): Promise<User> {
    if (!caller.isSuperAdmin && caller.companyId) {
      const membership = await this.userOrgRoleRepository.findOne({
        where: { userId: id, orgId: caller.companyId },
      });
      if (!membership) {
        throw new ForbiddenException('You can only disable users in your organization');
      }
    }
    const user = await this.findOne(id);
    if (user.registrationStatus !== RegistrationStatus.ACTIVE) {
      throw new ConflictException('Only registered users can be disabled');
    }
    user.isActive = false;
    const saved = await this.usersRepository.save(user);
    await this.authClientService.disableCredentials(id);
    await this.authClientService.revokeAllTokens(id);
    this.emitAuditLog({
      actorId:      caller.actorId,
      action:       'USER_DISABLED',
      resourceId:   id,
      resourceName: userDisplayName(user),
    });
    return saved;
  }

  async enable(
    id: string,
    caller: { actorId?: string; companyId?: string; isSuperAdmin?: boolean },
  ): Promise<User> {
    if (!caller.isSuperAdmin && caller.companyId) {
      const membership = await this.userOrgRoleRepository.findOne({
        where: { userId: id, orgId: caller.companyId },
      });
      if (!membership) {
        throw new ForbiddenException('You can only enable users in your organization');
      }
    }
    const user = await this.findOne(id);
    if (user.registrationStatus !== RegistrationStatus.ACTIVE) {
      throw new ConflictException('Only registered users can be enabled');
    }
    user.isActive = true;
    const saved = await this.usersRepository.save(user);
    await this.authClientService.enableCredentials(id);
    this.emitAuditLog({
      actorId:      caller.actorId,
      action:       'USER_ENABLED',
      resourceId:   id,
      resourceName: userDisplayName(user),
    });
    return saved;
  }

  async setSuperAdmin(id: string, enabled: boolean, actorId?: string): Promise<User> {
    const user = await this.findOne(id);
    const previousState = user.isSuperAdmin;
    user.isSuperAdmin = enabled;
    const saved = await this.usersRepository.save(user);
    this.emitAuditLog({
      actorId,
      action:       'USER_SUPER_ADMIN_CHANGED',
      resourceId:   id,
      resourceName: userDisplayName(saved),
      metadata:     { changes: { isSuperAdmin: { from: previousState, to: enabled } } },
    });
    if (!enabled) {
      this.authClientService.revokeAllTokens(id).catch(() => undefined);
      this.kafkaProducer.emitSafe(TOPICS.USER_SUPER_ADMIN_REVOKED, { userId: id });
    }
    return saved;
  }

  async findByPosition(
    orgId: string,
    filters: { cargoId?: string; areaId?: string | null; departamentoId?: string },
  ): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string }[]> {
    const qb = this.usersRepository
      .createQueryBuilder('u')
      .innerJoin(
        'user_org_roles',
        'uor',
        'uor.user_id = u.id AND uor.org_id = :orgId AND uor.role_id IS NOT NULL',
        { orgId },
      )
      .where('u.is_active = true')
      .andWhere('u.deleted_at IS NULL');

    if (filters.departamentoId) {
      qb.andWhere('u.departamento_id = :departamentoId', { departamentoId: filters.departamentoId });
    }
    if (filters.cargoId) {
      qb.andWhere('u.cargo_id = :cargoId', { cargoId: filters.cargoId });
    }
    if ('areaId' in filters) {
      if (filters.areaId === null || filters.areaId === undefined) {
        qb.andWhere('u.area_id IS NULL');
      } else {
        qb.andWhere('u.area_id = :areaId', { areaId: filters.areaId });
      }
    }

    const users = await qb.getMany();
    return users.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }));
  }

  async getCountsByOrg(): Promise<{ orgId: string; total: number; active: number; inactive: number }[]> {
    const rows = await this.userOrgRoleRepository
      .createQueryBuilder('uor')
      .innerJoin('uor.user', 'u')
      .select('uor.org_id', 'orgId')
      .addSelect('COUNT(DISTINCT u.id)', 'total')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN u.is_active = true AND u.deleted_at IS NULL THEN u.id END)`,
        'active',
      )
      .where('uor.role_id IS NOT NULL')
      .andWhere('u.is_super_admin = false')
      .groupBy('uor.org_id')
      .getRawMany<{ orgId: string; total: string; active: string }>();

    return rows.map((r) => ({
      orgId:    r.orgId,
      total:    parseInt(r.total,  10),
      active:   parseInt(r.active, 10),
      inactive: parseInt(r.total,  10) - parseInt(r.active, 10),
    }));
  }
}
