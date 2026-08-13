import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import Redis from 'ioredis';
import { User, RegistrationStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuthClientService } from '../auth-client/auth-client.service';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { Role, SystemRoleName, RoleScope } from '../roles/entities/role.entity';
import { OrgClientService } from '../common/org-client/org-client.service';
import { KafkaProducerService, TOPICS, getClientIp } from '@sgd/common';
import { userDisplayName, INVITATION_TTL_SECONDS } from './user.helpers';

@Injectable()
export class UserRegistrationService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly authClientService: AuthClientService,
    private readonly orgClientService: OrgClientService,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
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

  private async generateAndEmitInvitation(
    user: User,
  ): Promise<{ user: User; invitationToken: string }> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.redis.setex(`invitation:${tokenHash}`, INVITATION_TTL_SECONDS, user.id);

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
      throw new ConflictException({
        message: 'User with this email was previously deleted. Use the restore endpoint to reactivate them.',
        errorCode: 'USER_PREVIOUSLY_DELETED',
        params: { userId: existing.id },
      });
    }

    if (existing) {
      if (existing.registrationStatus === RegistrationStatus.PENDING_CREDENTIALS) {
        if (orgId) {
          const membership = await this.userOrgRoleRepository.findOne({
            where: { userId: existing.id, orgId, removedAt: IsNull() },
          });
          if (!membership) {
            throw new ConflictException({
              message: 'User with this email already exists in another organization',
              errorCode: 'USER_ALREADY_IN_ANOTHER_ORG',
              params: { userId: existing.id },
            });
          }
        }
        const { user, invitationToken } = await this.generateAndEmitInvitation(existing);
        return { user, invitationToken, invitationResent: true };
      }
      throw new ConflictException({
        message: 'User with this email already exists',
        errorCode: 'USER_ALREADY_EXISTS',
        params: { userId: existing.id },
      });
    }

    // Resolve roleId before persisting the user so a missing role aborts the request cleanly.
    let roleId: string | null = null;
    if (dto.orgId) {
      if (dto.roleId) {
        const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
        if (!role) {
          throw new NotFoundException({
            message: `Role ${dto.roleId} not found`,
            errorCode: 'ROLE_NOT_FOUND',
            params: { roleId: dto.roleId },
          });
        }
        roleId = role.id;
      } else {
        const adminRole = await this.roleRepository.findOne({
          where: { name: SystemRoleName.ADMIN, scope: RoleScope.SYSTEM, orgId: IsNull() },
        });
        if (adminRole) roleId = adminRole.id;
      }
    }

    // Validates departamentoId/areaId/cargoId against org-service before
    // persisting — mirrors the guard UserProfileService.update() already
    // applies on structure changes. Without this, a user could be created
    // pointing at a departamento/area/cargo that doesn't exist (or that
    // org-service deletes mid-request) with nothing to catch it — this is
    // also load-bearing for the cross-service TOCTOU fix (see
    // BulkStructureService.resolveStructureById() / StructureLease in
    // org-service): every write path that persists a new org-structure
    // reference must obtain a lease first, or a concurrent delete can't see
    // it coming. Prefers dto.orgId — the org the new user is explicitly
    // being placed into, which can differ from the caller's own org for a
    // super-admin — but falls back to the caller's own org (the `orgId`
    // param, e.g. a regular admin whose request doesn't echo their org back
    // in the body) rather than requiring it to be spelled out in the DTO.
    if (dto.departamentoId != null || dto.areaId != null || dto.cargoId != null) {
      if (dto.departamentoId == null) {
        throw new BadRequestException('departamentoId is required when assigning an area or cargo');
      }
      const structureOrgId = dto.orgId ?? orgId;
      if (!structureOrgId) {
        throw new BadRequestException('orgId is required when assigning departamentoId/areaId/cargoId');
      }
      await this.orgClientService.validateOrgStructure(structureOrgId, dto.departamentoId, dto.areaId, dto.cargoId);
    }

    const user = this.usersRepository.create(dto);
    await this.usersRepository.save(user);

    this.emitAuditLog({
      actorId,
      orgId:        orgId ?? dto.orgId,
      action:       'USER_CREATED',
      resourceId:   user.id,
      resourceName: userDisplayName(user),
      metadata:     { isSuperAdmin: user.isSuperAdmin },
    });

    if (dto.orgId && roleId) {
      const record = this.userOrgRoleRepository.create({
        userId: user.id,
        orgId: dto.orgId,
        roleId,
        assignedBy: null,
      });
      await this.userOrgRoleRepository.save(record);
    }

    return this.generateAndEmitInvitation(user);
  }

  async resendInvitation(
    userId: string,
    callerOrgId?: string,
  ): Promise<{ user: User; invitationToken: string }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ message: `User ${userId} not found`, errorCode: 'USER_NOT_FOUND', params: { userId } });
    }

    if (user.registrationStatus !== RegistrationStatus.PENDING_CREDENTIALS) {
      throw new ConflictException({
        message: 'User has already completed registration',
        errorCode: 'USER_REGISTRATION_ALREADY_COMPLETED',
      });
    }

    if (callerOrgId) {
      const membership = await this.userOrgRoleRepository.findOne({
        where: { userId: user.id, orgId: callerOrgId, removedAt: IsNull() },
      });
      if (!membership) {
        throw new ConflictException({
          message: 'You can only resend invitations for users in your organization',
          errorCode: 'USER_NOT_IN_CALLER_ORG',
        });
      }
    }

    return this.generateAndEmitInvitation(user);
  }

  async provision(id: string, dto: ProvisionUserDto): Promise<{ ok: boolean }> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException({ message: `User ${id} not found`, errorCode: 'USER_NOT_FOUND', params: { userId: id } });
    }

    await this.authClientService.provisionCredentials({
      userId: user.id,
      email: user.email,
      password: dto.password,
    });

    return { ok: true };
  }

  async completeRegistration(dto: CompleteRegistrationDto): Promise<UserResponseDto> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const hashKey  = `invitation:${tokenHash}`;
    const plainKey = `invitation:${dto.token}`;

    // Read without consuming so any downstream failure leaves the token intact for retry.
    let userId = await this.redis.get(hashKey);
    if (!userId) {
      // Fallback: invitations issued before hashing was introduced stored the plaintext token.
      userId = await this.redis.get(plainKey);
    }
    if (!userId) {
      throw new NotFoundException({
        message: 'Invitation token invalid or expired',
        errorCode: 'INVITATION_TOKEN_INVALID',
      });
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ message: `User ${userId} not found`, errorCode: 'USER_NOT_FOUND', params: { userId } });
    }

    try {
      await this.authClientService.provisionCredentials({
        userId: user.id,
        email:  user.email,
        password: dto.password,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        if (status >= 400 && status < 500) {
          const body = error.getResponse();
          const upstreamErrorCode =
            typeof body === 'object' && body !== null && 'errorCode' in body
              ? (body as { errorCode?: string }).errorCode
              : undefined;
          throw new HttpException(
            { message: 'Invalid registration data', errorCode: upstreamErrorCode ?? 'REGISTRATION_DATA_INVALID' },
            status,
          );
        }
        throw new InternalServerErrorException({
          message: 'Error creating access credentials',
          errorCode: 'REGISTRATION_FAILED',
        });
      }
      throw new InternalServerErrorException({
        message: 'Error creating access credentials',
        errorCode: 'REGISTRATION_FAILED',
      });
    }

    // Profile fields + activation in a single atomic write.
    await this.usersRepository.manager.transaction(async (manager) => {
      Object.assign(user, {
        firstName:          dto.firstName,
        lastName:           dto.lastName,
        idNumber:           dto.idNumber,
        registrationStatus: RegistrationStatus.ACTIVE,
        isActive:           true,
      });
      await manager.save(user);
    });

    // Consume the token only after the DB transaction commits.
    await Promise.all([
      this.redis.del(hashKey),
      this.redis.del(plainKey),
    ]);

    const completedUser = await this.usersRepository.findOne({ where: { id: user.id } });
    if (!completedUser) {
      throw new NotFoundException({ message: `User ${user.id} not found`, errorCode: 'USER_NOT_FOUND', params: { userId: user.id } });
    }

    return UserResponseDto.from(completedUser);
  }
}
