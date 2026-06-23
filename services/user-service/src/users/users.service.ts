import { Injectable } from '@nestjs/common';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { AssignOrgDto } from './dto/assign-org.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { UserProfileService } from './user-profile.service';
import { UserOrgService } from './user-org.service';
import { UserRegistrationService } from './user-registration.service';

/**
 * Public facade — delegates to domain-focused sub-services.
 * Controllers only interact with this class; sub-services are not exported from UsersModule.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly profile: UserProfileService,
    private readonly org: UserOrgService,
    private readonly registration: UserRegistrationService,
  ) {}

  // ── Profile ────────────────────────────────────────────────────────────────

  findOne(id: string): Promise<User> {
    return this.profile.findOne(id);
  }

  findManyByIds(ids: string[]): Promise<User[]> {
    return this.profile.findManyByIds(ids);
  }

  findByEmail(email: string): Promise<User> {
    return this.profile.findByEmail(email);
  }

  findAll(limit?: number, cursor?: string) {
    return this.profile.findAll(limit, cursor);
  }

  findAllSuperAdmin(
    limit?: number,
    cursor?: string,
    search?: string,
    status?: 'active' | 'inactive' | 'deleted' | 'pending',
  ) {
    return this.profile.findAllSuperAdmin(limit, cursor, search, status);
  }

  update(id: string, dto: UpdateUserDto, actorId?: string, orgId?: string): Promise<User> {
    return this.profile.update(id, dto, actorId, orgId);
  }

  uploadAvatar(userId: string, avatarUrl: string): Promise<User> {
    return this.profile.uploadAvatar(userId, avatarUrl);
  }

  globalRemove(id: string, actorId?: string): Promise<void> {
    return this.profile.globalRemove(id, actorId);
  }

  restore(id: string, actorId?: string): Promise<User> {
    return this.profile.restore(id, actorId);
  }

  disable(id: string, caller: { actorId?: string; companyId?: string; isSuperAdmin?: boolean }): Promise<User> {
    return this.profile.disable(id, caller);
  }

  enable(id: string, caller: { actorId?: string; companyId?: string; isSuperAdmin?: boolean }): Promise<User> {
    return this.profile.enable(id, caller);
  }

  setSuperAdmin(id: string, enabled: boolean, actorId?: string): Promise<User> {
    return this.profile.setSuperAdmin(id, enabled, actorId);
  }

  findByPosition(
    orgId: string,
    filters: { cargoId?: string; areaId?: string | null; departamentoId?: string },
  ) {
    return this.profile.findByPosition(orgId, filters);
  }

  getCountsByOrg() {
    return this.profile.getCountsByOrg();
  }

  // ── Org membership ─────────────────────────────────────────────────────────

  getCompanies(userId: string): Promise<string[]> {
    return this.org.getCompanies(userId);
  }

  assignOrg(userId: string, dto: AssignOrgDto, assignedBy: string): Promise<UserOrgRole> {
    return this.org.assignOrg(userId, dto, assignedBy);
  }

  findByOrg(orgId: string, limit?: number, cursor?: string) {
    return this.org.findByOrg(orgId, limit, cursor);
  }

  removeRoleFromOrg(userId: string, orgId: string, roleId: string, actorId?: string): Promise<void> {
    return this.org.removeRoleFromOrg(userId, orgId, roleId, actorId);
  }

  removeFromOrg(userId: string, orgId: string, actorId?: string): Promise<void> {
    return this.org.removeFromOrg(userId, orgId, actorId);
  }

  removeAllFromOrg(orgId: string): Promise<void> {
    return this.org.removeAllFromOrg(orgId);
  }

  getOrgRoles(userId: string): Promise<UserOrgRole[]> {
    return this.org.getOrgRoles(userId);
  }

  getMyOrgRoles(userId: string, orgId: string): Promise<UserOrgRole[]> {
    return this.org.getMyOrgRoles(userId, orgId);
  }

  getEffectivePermissions(userId: string, orgId: string): Promise<{ module: string; action: string }[]> {
    return this.org.getEffectivePermissions(userId, orgId);
  }

  setOptionalReviewer(userId: string, orgId: string, value: boolean, actorId?: string): Promise<void> {
    return this.org.setOptionalReviewer(userId, orgId, value, actorId);
  }

  // ── Registration & provisioning ────────────────────────────────────────────

  create(
    dto: CreateUserDto,
    actorId?: string,
    orgId?: string,
  ): Promise<{ user: User; invitationToken: string; invitationResent?: boolean }> {
    return this.registration.create(dto, actorId, orgId);
  }

  resendInvitation(
    userId: string,
    callerOrgId?: string,
  ): Promise<{ user: User; invitationToken: string }> {
    return this.registration.resendInvitation(userId, callerOrgId);
  }

  provision(id: string, dto: ProvisionUserDto): Promise<{ ok: boolean }> {
    return this.registration.provision(id, dto);
  }

  completeRegistration(dto: CompleteRegistrationDto): Promise<UserResponseDto> {
    return this.registration.completeRegistration(dto);
  }
}
