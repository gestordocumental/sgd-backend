import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  HttpException,
  Inject,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Not, Repository } from "typeorm";
import { randomBytes } from "crypto";
import Redis from "ioredis";
import { User, RegistrationStatus } from "./entities/user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ProvisionUserDto } from "./dto/provision-user.dto";
import { AssignOrgDto } from "./dto/assign-org.dto";
import { CompleteRegistrationDto } from "./dto/complete-registration.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { AuthClientService } from "../auth-client/auth-client.service";
import { UserOrgRole } from "../roles/entities/user-org-role.entity";
import { Role, SystemRoleName, RoleScope } from "../roles/entities/role.entity";
import { KafkaProducerService } from "../common/kafka/kafka-producer.service";
import { TOPICS } from "../common/kafka/kafka.constants";
import { getClientIp } from "../common/correlation/correlation.context";

const INVITATION_TTL_SECONDS = 72 * 60 * 60; // 259200s = 72h

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly authClientService: AuthClientService,
    @Inject("REDIS_CLIENT")
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  private static userDisplayName(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
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
      metadata:     params.metadata,
      timestamp:    new Date().toISOString(),
    });
  }

  async create(
    dto: CreateUserDto,
    actorId?: string,
    orgId?: string,
  ): Promise<{ user: User; invitationToken: string; invitationResent?: boolean }> {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    if (existing?.deletedAt) {
      // Soft-deleted user — the email is free at DB level but the record exists.
      // Caller should restore the user and then assign them to the org.
      throw new ConflictException({
        message:
          "User with this email was previously deleted. Use the restore endpoint to reactivate them.",
        userId: existing.id,
      });
    }

    if (existing) {
      // PENDING user — token may have expired. Resend invitation instead of failing.
      if (existing.registrationStatus === RegistrationStatus.PENDING_CREDENTIALS) {
        // Security: only resend if the caller's org already has a membership for this user,
        // or there is no org scope (super-admin creating a global user).
        if (orgId) {
          const membership = await this.userOrgRoleRepository.findOne({
            where: { userId: existing.id, orgId },
          });
          if (!membership) {
            throw new ConflictException({
              message: "User with this email already exists in another organization",
              userId: existing.id,
            });
          }
        }
        const { user, invitationToken } = await this.generateAndEmitInvitation(existing);
        return { user, invitationToken, invitationResent: true };
      }
      // Active user already exists — caller should assign them to the org via user_org_roles
      throw new ConflictException({
        message: "User with this email already exists",
        userId: existing.id,
      });
    }

    const user = this.usersRepository.create(dto);
    await this.usersRepository.save(user);

    this.emitAuditLog({
      actorId:      actorId,
      orgId:        orgId ?? dto.orgId,
      action:       'USER_CREATED',
      resourceId:   user.id,
      resourceName: UsersService.userDisplayName(user),
      metadata:     { isSuperAdmin: user.isSuperAdmin },
    });

    // Assign role in the org if orgId was provided
    if (dto.orgId) {
      let roleId: string | null = null;

      if (dto.roleId) {
        // Validate and use the explicitly requested role
        const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
        if (!role) throw new NotFoundException(`Role ${dto.roleId} not found`);
        roleId = role.id;
      } else {
        // Fall back to the system ADMIN role
        const adminRole = await this.roleRepository.findOne({
          where: {
            name: SystemRoleName.ADMIN,
            scope: RoleScope.SYSTEM,
            orgId: IsNull(),
          },
        });
        if (adminRole) roleId = adminRole.id;
      }

      if (roleId) {
        const record = this.userOrgRoleRepository.create({
          userId: user.id,
          orgId: dto.orgId,
          roleId,
          assignedBy: null,
        });
        await this.userOrgRoleRepository.save(record);
      }
    }

    return this.generateAndEmitInvitation(user);
  }

  /**
   * Resends the invitation email for a user that has not yet completed registration.
   * Generates a new token (the previous one expires naturally in Redis).
   * Throws ConflictException if the user is already ACTIVE.
   */
  async resendInvitation(userId: string, callerOrgId?: string): Promise<{ user: User; invitationToken: string }> {
    const user = await this.findOne(userId);

    if (user.registrationStatus !== RegistrationStatus.PENDING_CREDENTIALS) {
      throw new ConflictException("User has already completed registration");
    }

    if (callerOrgId) {
      const membership = await this.userOrgRoleRepository.findOne({
        where: { userId: user.id, orgId: callerOrgId },
      });
      if (!membership) {
        throw new ForbiddenException("You can only resend invitations for users in your organization");
      }
    }

    return this.generateAndEmitInvitation(user);
  }

  /**
   * Generates a one-time invitation token, stores it in Redis and emits the Kafka event.
   * Shared between create() and resendInvitation().
   */
  private async generateAndEmitInvitation(
    user: User,
  ): Promise<{ user: User; invitationToken: string }> {
    const token = randomBytes(32).toString("hex");
    await this.redis.setex(`invitation:${token}`, INVITATION_TTL_SECONDS, user.id);

    try {
      const expiresAt = new Date(Date.now() + INVITATION_TTL_SECONDS * 1000).toISOString();
      await this.kafkaProducer.emit(TOPICS.USER_INVITED, {
        userId: user.id,
        email: user.email,
        invitationToken: token,
        expiresAt,
      });
    } catch {
      // Kafka is best-effort — admin still receives the token in the response
    }

    return { user, invitationToken: token };
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findAllSuperAdmin(): Promise<User[]> {
    return this.usersRepository.find({ where: { isSuperAdmin: true } });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) throw new NotFoundException(`User not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string, orgId?: string): Promise<User> {
    const user = await this.findOne(id);

    const before: Record<string, unknown> = {}
    for (const key of Object.keys(dto)) before[key] = (user as unknown as Record<string, unknown>)[key]

    Object.assign(user, dto);
    const saved = await this.usersRepository.save(user);

    if (actorId) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const key of Object.keys(dto)) {
        const to = (dto as Record<string, unknown>)[key]
        if (before[key] !== to) changes[key] = { from: before[key], to }
      }
      this.emitAuditLog({
        actorId,
        orgId,
        action:       'USER_UPDATED',
        resourceId:   id,
        resourceName: UsersService.userDisplayName(saved),
        metadata:     { changes },
      });
    }
    return saved;
  }

  async uploadAvatar(userId: string, filename: string): Promise<User> {
    const user = await this.findOne(userId);
    user.avatarUrl = `/uploads/avatars/${filename}`;
    return this.usersRepository.save(user);
  }

  async remove(id: string, callerOrgId?: string, actorId?: string): Promise<void> {
    if (callerOrgId) {
      // Org-scoped delete: only remove the user's membership from the caller's org.
      // The user account and credentials remain intact so they can still access other orgs.
      return this.removeFromOrg(id, callerOrgId, actorId);
    }
    // Global delete (super admin, no companyId): soft-delete the account and disable credentials.
    const user = await this.findOne(id);
    await this.usersRepository.softRemove(user);
    // Disable credentials so the soft-deleted user cannot log in.
    // If auth-service fails the user record stays soft-deleted — the admin can retry.
    await this.authClientService.disableCredentials(user.id);
    if (actorId) {
      this.emitAuditLog({
        actorId,
        action:       'USER_DELETED',
        resourceId:   id,
        resourceName: UsersService.userDisplayName(user),
      });
    }
  }

  async restore(id: string, actorId?: string): Promise<User> {
    await this.usersRepository.restore(id);
    // Re-enable credentials so the restored user can log in again.
    // If auth-service fails the user record stays restored — the admin can retry.
    await this.authClientService.enableCredentials(id);
    const restored = await this.findOne(id);
    this.emitAuditLog({ actorId, action: 'USER_RESTORED', resourceId: id, resourceName: UsersService.userDisplayName(restored) });
    return restored;
  }

  /**
   * Returns the list of orgIds the user belongs to, ordered by first membership (ASC).
   * The first element is treated as the default company by auth-service / frontend.
   */
  async getCompanies(userId: string): Promise<string[]> {
    // Only return orgs where the user has an active role (roleId not null).
    // removeFromOrg nulls the roleId without deleting the row, so filtering here
    // prevents removed orgs from appearing in the user's company list.
    const rows = await this.userOrgRoleRepository.find({
      where: { userId, roleId: Not(IsNull()) },
      order: { createdAt: "ASC" },
    });

    // Deduplicate orgIds preserving first-occurrence order
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

  /**
   * Provisions login credentials for a user by calling auth-service.
   * Called after the user record exists and has been assigned to an org.
   * If auth-service fails the user record is NOT rolled back — the admin
   * can retry calling this endpoint.
   */
  async provision(id: string, dto: ProvisionUserDto): Promise<{ ok: boolean }> {
    const user = await this.findOne(id);

    await this.authClientService.provisionCredentials({
      userId: user.id,
      email: user.email,
      password: dto.password,
    });

    return { ok: true };
  }

  async setSuperAdmin(id: string, enabled: boolean, actorId?: string): Promise<User> {
    const user = await this.findOne(id);
    user.isSuperAdmin = enabled;
    const saved = await this.usersRepository.save(user);
    this.emitAuditLog({
      actorId,
      action:       'USER_SUPER_ADMIN_CHANGED',
      resourceId:   id,
      resourceName: UsersService.userDisplayName(saved),
      metadata:     { enabled },
    });
    return saved;
  }

  async assignOrg(
    userId: string,
    dto: AssignOrgDto,
    assignedBy: string,
  ): Promise<UserOrgRole> {
    const targetUser = await this.findOne(userId);
    const roleId = dto.roleId ?? null;

    // If the user already has a membership record for this org, just update the role
    const existing = await this.userOrgRoleRepository.findOne({
      where: { userId, orgId: dto.orgId },
    });

    if (existing) {
      if (existing.roleId === roleId) {
        throw new ConflictException("User already has this role in this org");
      }
      await this.userOrgRoleRepository.update(existing.id, {
        roleId,
        assignedBy,
      });
      this.emitAuditLog({
        actorId:      assignedBy,
        orgId:        dto.orgId,
        action:       'USER_ORG_ROLE_UPDATED',
        resourceId:   userId,
        resourceName: UsersService.userDisplayName(targetUser),
        metadata:     { orgId: dto.orgId, roleId },
      });
      return this.userOrgRoleRepository.findOne({
        where: { id: existing.id },
        relations: ['role'],
      }) as Promise<UserOrgRole>;
    }

    const record = this.userOrgRoleRepository.create({
      userId,
      orgId: dto.orgId,
      roleId,
      assignedBy,
    });
    const saved = await this.userOrgRoleRepository.save(record);
    this.emitAuditLog({
      actorId:      assignedBy,
      orgId:        dto.orgId,
      action:       'USER_ORG_ASSIGNED',
      resourceId:   userId,
      resourceName: UsersService.userDisplayName(targetUser),
      metadata:     { orgId: dto.orgId, roleId },
    });
    return saved;
  }

  async findByOrg(
    orgId: string,
  ): Promise<{ user: User; roles: { roleId: string; roleName: string }[] }[]> {
    // All membership records for this org (including those with role_id = NULL)
    const orgRoles = await this.userOrgRoleRepository.find({
      where: { orgId },
      relations: ['user', 'role'],
    });

    if (orgRoles.length === 0) return [];

    // Group by userId, collecting only records that have a role assigned
    const byUser = new Map<string, { user: User; roles: { roleId: string; roleName: string }[] }>();
    for (const r of orgRoles) {
      if (!r.user) continue; // user was soft-deleted; relation resolves to null
      if (!byUser.has(r.userId)) {
        byUser.set(r.userId, { user: r.user, roles: [] });
      }
      if (r.roleId !== null && r.role !== null) {
        byUser.get(r.userId)!.roles.push({ roleId: r.roleId, roleName: r.role.name });
      }
    }

    return Array.from(byUser.values());
  }

  async getOrgRoles(userId: string): Promise<UserOrgRole[]> {
    await this.findOne(userId);
    return this.userOrgRoleRepository.find({
      where: { userId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Returns the current user's role assignments for a specific org.
   * Used by the frontend to determine which UI sections to show,
   * without requiring USERS:READ permission (users can always see their own roles).
   */
  async getMyOrgRoles(userId: string, orgId: string): Promise<UserOrgRole[]> {
    // Exclude records with roleId = NULL (user was removed from the org).
    return this.userOrgRoleRepository.find({
      where: { userId, orgId, roleId: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });
  }

  async removeFromOrg(userId: string, orgId: string, actorId?: string): Promise<void> {
    const targetUser = await this.findOne(userId);
    await this.userOrgRoleRepository.query(
      `UPDATE user_org_roles SET role_id = NULL, assigned_by = NULL WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId],
    );
    if (actorId) {
      this.emitAuditLog({
        actorId,
        orgId,
        action:       'USER_REMOVED_FROM_ORG',
        resourceId:   userId,
        resourceName: UsersService.userDisplayName(targetUser),
        metadata:     { orgId },
      });
    }
  }

  /**
   * Completes the user's registration using a one-time invitation token.
   * Updates the user profile and provisions credentials in auth-service,
   * then invalidates the token so it cannot be reused.
   */
  async completeRegistration(
    dto: CompleteRegistrationDto,
  ): Promise<UserResponseDto> {
    // GETDEL is atomic: retrieves and deletes in one operation, preventing
    // TOCTOU race conditions where two concurrent requests consume the same token.
    const userId = await this.redis.getdel(`invitation:${dto.token}`);
    if (!userId) {
      throw new NotFoundException("Invitation token invalid or expired");
    }

    const user = await this.update(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      idNumber: dto.idNumber,
    });

    try {
      await this.authClientService.provisionCredentials({
        userId: user.id,
        email: user.email,
        password: dto.password,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        if (status >= 400 && status < 500) {
          throw new HttpException("Invalid registration data", status);
        }
        throw new InternalServerErrorException(
          "Error creating access credentials",
        );
      }
      throw new InternalServerErrorException(
        "Error creating access credentials",
      );
    }

    // Use a transaction to ensure atomicity
    await this.usersRepository.manager.transaction(async (manager) => {
      // Credentials created successfully — mark registration as complete and activate account
      user.registrationStatus = RegistrationStatus.ACTIVE;
      user.isActive = true;
      await manager.save(user);
    });

    // Token was already consumed atomically via GETDEL above.

    const completedUser = await this.findOne(user.id);

    return UserResponseDto.from(completedUser);
  }

  /**
   * Returns active users in a given org that match the provided org-structure position.
   * Called internally by workflow-service when a workflow is approved, to determine
   * which users should receive the finalized document.
   *
   * Filters are applied with AND logic. Passing areaId = null explicitly matches
   * users whose area_id IS NULL (dept-level position).
   */
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
      .getRawMany<{ orgId: string; total: string; active: string }>()

    return rows.map((r) => ({
      orgId:    r.orgId,
      total:    parseInt(r.total,  10),
      active:   parseInt(r.active, 10),
      inactive: parseInt(r.total,  10) - parseInt(r.active, 10),
    }))
  }
}
