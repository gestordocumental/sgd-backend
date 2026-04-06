import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
  Inject,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
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

  async create(
    dto: CreateUserDto,
  ): Promise<{ user: User; invitationToken: string }> {
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

    // Active user already exists — caller should assign them to the org via user_org_roles
    if (existing) {
      throw new ConflictException({
        message: "User with this email already exists",
        userId: existing.id,
      });
    }

    const user = this.usersRepository.create(dto);
    await this.usersRepository.save(user);

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

    // Generate a cryptographically secure one-time invitation token
    const token = randomBytes(32).toString("hex");
    await this.redis.setex(
      `invitation:${token}`,
      INVITATION_TTL_SECONDS,
      user.id,
    );

    // Emit Kafka event — failure must not break the main flow
    try {
      const expiresAt = new Date(
        Date.now() + INVITATION_TTL_SECONDS * 1000,
      ).toISOString();
      await this.kafkaProducer.emit("user.invited", {
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

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, dto);
    return this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.softRemove(user);
    // Disable credentials so the soft-deleted user cannot log in.
    // If auth-service fails the user record stays soft-deleted — the admin can retry.
    await this.authClientService.disableCredentials(user.id);
  }

  async restore(id: string): Promise<User> {
    await this.usersRepository.restore(id);
    // Re-enable credentials so the restored user can log in again.
    // If auth-service fails the user record stays restored — the admin can retry.
    await this.authClientService.enableCredentials(id);
    return this.findOne(id);
  }

  /**
   * Returns the list of orgIds the user belongs to, ordered by first membership (ASC).
   * The first element is treated as the default company by auth-service / frontend.
   */
  async getCompanies(userId: string): Promise<string[]> {
    const rows = await this.userOrgRoleRepository.find({
      where: { userId },
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

  async setSuperAdmin(id: string, enabled: boolean): Promise<User> {
    const user = await this.findOne(id);
    user.isSuperAdmin = enabled;
    return this.usersRepository.save(user);
  }

  async assignOrg(
    userId: string,
    dto: AssignOrgDto,
    assignedBy: string,
  ): Promise<UserOrgRole> {
    await this.findOne(userId);

    // If the user already has a membership record for this org, just update the role
    const existing = await this.userOrgRoleRepository.findOne({
      where: { userId, orgId: dto.orgId },
    });

    if (existing) {
      if (existing.roleId === dto.roleId) {
        throw new ConflictException("User already has this role in this org");
      }
      await this.userOrgRoleRepository.update(existing.id, {
        roleId: dto.roleId,
        assignedBy,
      });
      return this.userOrgRoleRepository.findOne({
        where: { id: existing.id },
        relations: ['role'],
      }) as Promise<UserOrgRole>;
    }

    const record = this.userOrgRoleRepository.create({
      userId,
      orgId: dto.orgId,
      roleId: dto.roleId,
      assignedBy,
    });
    return this.userOrgRoleRepository.save(record);
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

  async removeFromOrg(userId: string, orgId: string): Promise<void> {
    await this.findOne(userId);
    await this.userOrgRoleRepository.query(
      `UPDATE user_org_roles SET role_id = NULL, assigned_by = NULL WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId],
    );
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
}
