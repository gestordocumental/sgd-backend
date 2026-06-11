import {
  Injectable,
  NotFoundException,
  ConflictException,
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
        userId: existing.id,
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
              userId: existing.id,
            });
          }
        }
        const { user, invitationToken } = await this.generateAndEmitInvitation(existing);
        return { user, invitationToken, invitationResent: true };
      }
      throw new ConflictException({
        message: 'User with this email already exists',
        userId: existing.id,
      });
    }

    // Resolve roleId before persisting the user so a missing role aborts the request cleanly.
    let roleId: string | null = null;
    if (dto.orgId) {
      if (dto.roleId) {
        const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
        if (!role) throw new NotFoundException(`Role ${dto.roleId} not found`);
        roleId = role.id;
      } else {
        const adminRole = await this.roleRepository.findOne({
          where: { name: SystemRoleName.ADMIN, scope: RoleScope.SYSTEM, orgId: IsNull() },
        });
        if (adminRole) roleId = adminRole.id;
      }
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
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    if (user.registrationStatus !== RegistrationStatus.PENDING_CREDENTIALS) {
      throw new ConflictException('User has already completed registration');
    }

    if (callerOrgId) {
      const membership = await this.userOrgRoleRepository.findOne({
        where: { userId: user.id, orgId: callerOrgId, removedAt: IsNull() },
      });
      if (!membership) {
        throw new ConflictException('You can only resend invitations for users in your organization');
      }
    }

    return this.generateAndEmitInvitation(user);
  }

  async provision(id: string, dto: ProvisionUserDto): Promise<{ ok: boolean }> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

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
      throw new NotFoundException('Invitation token invalid or expired');
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

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
          throw new HttpException('Invalid registration data', status);
        }
        throw new InternalServerErrorException('Error creating access credentials');
      }
      throw new InternalServerErrorException('Error creating access credentials');
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
    if (!completedUser) throw new NotFoundException(`User ${user.id} not found`);

    return UserResponseDto.from(completedUser);
  }
}
