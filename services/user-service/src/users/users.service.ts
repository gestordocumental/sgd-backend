import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { AssignOrgDto } from './dto/assign-org.dto';
import { AuthClientService } from '../auth-client/auth-client.service';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepository: Repository<UserOrgRole>,
    private readonly authClientService: AuthClientService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    if (existing?.deletedAt) {
      // Soft-deleted user — the email is free at DB level but the record exists.
      // Caller should restore the user and then assign them to the org.
      throw new ConflictException({
        message: 'User with this email was previously deleted. Use the restore endpoint to reactivate them.',
        userId: existing.id,
      });
    }

    // Active user already exists — caller should assign them to the org via user_org_roles
    if (existing) {
      throw new ConflictException({
        message: 'User with this email already exists',
        userId: existing.id,
      });
    }

    const user = this.usersRepository.create(dto);
    return this.usersRepository.save(user);
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
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
      order: { createdAt: 'ASC' },
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
      userId:   user.id,
      email:    user.email,
      password: dto.password,
    });

    return { ok: true };
  }

  async setSuperAdmin(id: string, enabled: boolean): Promise<User> {
    const user = await this.findOne(id);
    user.isSuperAdmin = enabled;
    return this.usersRepository.save(user);
  }

  async assignOrg(userId: string, dto: AssignOrgDto, assignedBy: string): Promise<UserOrgRole> {
    await this.findOne(userId);

    const existing = await this.userOrgRoleRepository.findOne({
      where: { userId, orgId: dto.orgId, roleId: dto.roleId },
    });
    if (existing) {
      throw new ConflictException('User already has this role in this org');
    }

    const record = this.userOrgRoleRepository.create({
      userId,
      orgId: dto.orgId,
      roleId: dto.roleId,
      assignedBy,
    });
    return this.userOrgRoleRepository.save(record);
  }

  async getOrgRoles(userId: string): Promise<UserOrgRole[]> {
    await this.findOne(userId);
    return this.userOrgRoleRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async removeFromOrg(userId: string, orgId: string): Promise<void> {
    await this.findOne(userId);
    await this.userOrgRoleRepository.delete({ userId, orgId });
  }
}
