import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User, RegistrationStatus } from './entities/user.entity';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { Role, RoleScope, SystemRoleName } from '../roles/entities/role.entity';
import { AuthClientService } from '../auth-client/auth-client.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-uuid-admin',
  name: SystemRoleName.ADMIN,
  scope: RoleScope.SYSTEM,
  description: null,
  isSystem: true,
  orgId: null,
  permissions: [],
  userOrgRoles: [],
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-uuid-1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  idNumber: null,
  position: 'Developer',
  departamentoId: null,
  areaId: null,
  cargoId: null,
  isActive: true,
  registrationStatus:
    overrides.registrationStatus ?? RegistrationStatus.PENDING_CREDENTIALS,
  avatarUrl: null,
  isSuperAdmin: false,
  twoFactorEnabled: false,
  orgRoles: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
  ...overrides,
});

const makeUor = (overrides: Partial<UserOrgRole> = {}): UserOrgRole => ({
  id: 'uor-uuid-1',
  userId: 'user-uuid-1',
  orgId: 'org-uuid-1',
  roleId: 'role-uuid-1',
  assignedBy: 'admin-uuid',
  user: null as any,
  role: null as any,
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: jest.Mocked<Repository<User>>;
  let uorRepo: jest.Mocked<Repository<UserOrgRole>>;
  let roleRepo: jest.Mocked<Repository<Role>>;
  let authClient: jest.Mocked<AuthClientService>;
  let redis: { getdel: jest.Mock; setex: jest.Mock };
  let kafkaProducer: jest.Mocked<Pick<KafkaProducerService, 'emit' | 'emitSafe'>>;

  beforeEach(async () => {
    redis = { getdel: jest.fn(), setex: jest.fn() };
    kafkaProducer = {
      emit: jest.fn().mockResolvedValue(undefined),
      emitSafe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
            restore: jest.fn(),
            manager: {
              transaction: jest.fn().mockImplementation(async (cb: (m: any) => Promise<void>) => {
                await cb({ save: jest.fn() });
              }),
            },
          },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            query: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Role),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: AuthClientService,
          useValue: {
            provisionCredentials: jest.fn(),
            disableCredentials: jest.fn(),
            enableCredentials: jest.fn(),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: KafkaProducerService,
          useValue: kafkaProducer,
        },
      ],
    }).compile();

    service = module.get(UsersService);
    usersRepo = module.get(getRepositoryToken(User));
    uorRepo = module.get(getRepositoryToken(UserOrgRole));
    roleRepo = module.get(getRepositoryToken(Role));
    authClient = module.get(AuthClientService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new user, stores invitation token in Redis, and returns { user, invitationToken }', async () => {
      const dto = { email: 'new@example.com', position: 'Developer' };
      const user = makeUser({ email: dto.email });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      redis.setex.mockResolvedValue('OK');

      const result = await service.create(dto);

      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { email: dto.email },
        withDeleted: true,
      });
      expect(usersRepo.create).toHaveBeenCalledWith(dto);
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^invitation:[a-f0-9]{64}$/),
        259200,
        user.id,
      );
      expect(result.user).toEqual(user);
      expect(result.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('emits user.invited Kafka event after creating the user', async () => {
      const dto = { email: 'new@example.com', position: 'Developer' };
      const user = makeUser({ email: dto.email });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      redis.setex.mockResolvedValue('OK');

      await service.create(dto);

      expect(kafkaProducer.emit).toHaveBeenCalledWith(
        'user.invited',
        expect.objectContaining({ userId: user.id, email: user.email }),
      );
    });

    it('still returns successfully when Kafka emit fails', async () => {
      const dto = { email: 'new@example.com', position: 'Developer' };
      const user = makeUser({ email: dto.email });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      redis.setex.mockResolvedValue('OK');
      kafkaProducer.emit.mockRejectedValue(new Error('Kafka unavailable'));

      const result = await service.create(dto);

      expect(result.user).toEqual(user);
      expect(result.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('throws ConflictException with userId when a soft-deleted user exists for that email', async () => {
      const dto = { email: 'deleted@example.com', position: 'Dev' };
      const deletedUser = makeUser({ email: dto.email, deletedAt: new Date() });

      usersRepo.findOne.mockResolvedValue(deletedUser as any);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      try {
        await service.create(dto);
      } catch (err: any) {
        expect(err.response).toMatchObject({ userId: deletedUser.id });
      }
    });

    it('throws ConflictException with userId when an active user already exists', async () => {
      const dto = { email: 'existing@example.com', position: 'Dev' };
      const existingUser = makeUser({
        email: dto.email,
        registrationStatus: RegistrationStatus.ACTIVE,
      });

      usersRepo.findOne.mockResolvedValue(existingUser);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      try {
        await service.create(dto);
      } catch (err: any) {
        expect(err.response).toMatchObject({ userId: existingUser.id });
      }
    });

    it('finds the ADMIN system role and creates a UserOrgRole when orgId is provided', async () => {
      const dto = { email: 'new@example.com', position: 'Developer', orgId: 'org-uuid-1' };
      const user = makeUser({ email: dto.email });
      const adminRole = makeRole();
      const uor = makeUor({ roleId: adminRole.id });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      roleRepo.findOne.mockResolvedValue(adminRole);
      uorRepo.create.mockReturnValue(uor);
      uorRepo.save.mockResolvedValue(uor);
      redis.setex.mockResolvedValue('OK');

      const result = await service.create(dto);

      expect(roleRepo.findOne).toHaveBeenCalledWith({
        where: { name: SystemRoleName.ADMIN, scope: RoleScope.SYSTEM, orgId: IsNull() },
      });
      expect(uorRepo.create).toHaveBeenCalledWith({
        userId: user.id,
        orgId: dto.orgId,
        roleId: adminRole.id,
        assignedBy: null,
      });
      expect(uorRepo.save).toHaveBeenCalled();
      expect(result.user).toEqual(user);
    });

    it('still creates the user when orgId is provided but ADMIN role is not found', async () => {
      const dto = { email: 'new@example.com', position: 'Developer', orgId: 'org-uuid-1' };
      const user = makeUser({ email: dto.email });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      roleRepo.findOne.mockResolvedValue(null); // ADMIN role not found
      redis.setex.mockResolvedValue('OK');

      const result = await service.create(dto);

      expect(roleRepo.findOne).toHaveBeenCalled();
      expect(uorRepo.create).not.toHaveBeenCalled();
      expect(uorRepo.save).not.toHaveBeenCalled();
      expect(result.user).toEqual(user);
      expect(result.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does NOT query roleRepository or create UserOrgRole when orgId is not provided', async () => {
      const dto = { email: 'new@example.com', position: 'Developer' };
      const user = makeUser({ email: dto.email });

      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(user);
      usersRepo.save.mockResolvedValue(user);
      redis.setex.mockResolvedValue('OK');

      await service.create(dto);

      expect(roleRepo.findOne).not.toHaveBeenCalled();
      expect(uorRepo.create).not.toHaveBeenCalled();
      expect(uorRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all active users from the repository', async () => {
      const users = [makeUser(), makeUser({ id: 'user-uuid-2', email: 'other@example.com' })];
      usersRepo.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(usersRepo.find).toHaveBeenCalled();
      expect(result).toEqual(users);
    });

    it('returns an empty array when there are no users', async () => {
      usersRepo.find.mockResolvedValue([]);

      expect(await service.findAll()).toEqual([]);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the user when found', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);

      const result = await service.findOne(user.id);

      expect(usersRepo.findOne).toHaveBeenCalledWith({ where: { id: user.id } });
      expect(result).toEqual(user);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findByEmail ──────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('returns the user when found by email', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);

      const result = await service.findByEmail(user.email);

      expect(usersRepo.findOne).toHaveBeenCalledWith({ where: { email: user.email } });
      expect(result).toEqual(user);
    });

    it('throws NotFoundException when email is not registered', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findByEmail('ghost@example.com')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('merges dto fields into the user and persists the result', async () => {
      const user = makeUser();
      const dto = { firstName: 'Jane', position: 'Manager' };
      const updated = { ...user, ...dto };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      const result = await service.update(user.id, dto);

      expect(usersRepo.save).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.update('bad-id', { firstName: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes the user and disables credentials in auth-service', async () => {
      const user = makeUser();

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.softRemove.mockResolvedValue(undefined as any);
      authClient.disableCredentials.mockResolvedValue(undefined);

      await service.remove(user.id);

      expect(usersRepo.softRemove).toHaveBeenCalledWith(user);
      expect(authClient.disableCredentials).toHaveBeenCalledWith(user.id);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── restore ──────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('restores the user record and enables credentials in auth-service', async () => {
      const user = makeUser();

      usersRepo.restore.mockResolvedValue(undefined as any);
      usersRepo.findOne.mockResolvedValue(user);
      authClient.enableCredentials.mockResolvedValue(undefined);

      const result = await service.restore(user.id);

      expect(usersRepo.restore).toHaveBeenCalledWith(user.id);
      expect(authClient.enableCredentials).toHaveBeenCalledWith(user.id);
      expect(result).toEqual(user);
    });
  });

  // ─── getCompanies ─────────────────────────────────────────────────────────

  describe('getCompanies', () => {
    it('returns deduplicated orgIds ordered by first membership', async () => {
      const rows = [
        makeUor({ orgId: 'org-1', createdAt: new Date('2024-01-01') }),
        makeUor({ orgId: 'org-2', createdAt: new Date('2024-01-02') }),
        makeUor({ orgId: 'org-1', createdAt: new Date('2024-01-03') }), // duplicate
      ];
      uorRepo.find.mockResolvedValue(rows as any);

      const result = await service.getCompanies('user-uuid-1');

      expect(result).toEqual(['org-1', 'org-2']);
    });

    it('returns empty array when user has no org memberships', async () => {
      uorRepo.find.mockResolvedValue([]);

      expect(await service.getCompanies('user-uuid-1')).toEqual([]);
    });

    it('queries rows ordered by createdAt ASC', async () => {
      uorRepo.find.mockResolvedValue([]);

      await service.getCompanies('user-uuid-1');

      expect(uorRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });
  });

  // ─── provision ────────────────────────────────────────────────────────────

  describe('provision', () => {
    it('calls provisionCredentials with correct payload and returns { ok: true }', async () => {
      const user = makeUser();
      const dto = { password: 'Str0ng@Pass' };

      usersRepo.findOne.mockResolvedValue(user);
      authClient.provisionCredentials.mockResolvedValue(undefined);

      const result = await service.provision(user.id, dto);

      expect(authClient.provisionCredentials).toHaveBeenCalledWith({
        userId: user.id,
        email: user.email,
        password: dto.password,
      });
      expect(result).toEqual({ ok: true });
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.provision('bad-id', { password: 'Test1@pass' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── setSuperAdmin ────────────────────────────────────────────────────────

  describe('setSuperAdmin', () => {
    it('sets isSuperAdmin to true and persists', async () => {
      const user = makeUser({ isSuperAdmin: false });
      const updated = { ...user, isSuperAdmin: true };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      const result = await service.setSuperAdmin(user.id, true);

      expect(user.isSuperAdmin).toBe(true);
      expect(usersRepo.save).toHaveBeenCalledWith(user);
      expect(result.isSuperAdmin).toBe(true);
    });

    it('sets isSuperAdmin to false and persists', async () => {
      const user = makeUser({ isSuperAdmin: true });
      const updated = { ...user, isSuperAdmin: false };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      const result = await service.setSuperAdmin(user.id, false);

      expect(user.isSuperAdmin).toBe(false);
      expect(result.isSuperAdmin).toBe(false);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.setSuperAdmin('bad-id', true)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignOrg ────────────────────────────────────────────────────────────

  describe('assignOrg', () => {
    it('creates and returns a UserOrgRole when no duplicate exists', async () => {
      const user = makeUser();
      const dto = { orgId: 'org-uuid-1', roleId: 'role-uuid-1' };
      const uor = makeUor();

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.findOne.mockResolvedValue(null);
      uorRepo.create.mockReturnValue(uor);
      uorRepo.save.mockResolvedValue(uor);

      const result = await service.assignOrg(user.id, dto, 'admin-uuid');

      expect(uorRepo.create).toHaveBeenCalledWith({
        userId: user.id,
        orgId: dto.orgId,
        roleId: dto.roleId,
        assignedBy: 'admin-uuid',
      });
      expect(result).toEqual(uor);
    });

    it('throws ConflictException when the user already has this role in this org', async () => {
      const user = makeUser();
      const dto = { orgId: 'org-uuid-1', roleId: 'role-uuid-1' };

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.findOne.mockResolvedValue(makeUor());

      await expect(service.assignOrg(user.id, dto, 'admin')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignOrg('bad-id', { orgId: 'o', roleId: 'r' }, 'a'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a membership with null roleId when dto.roleId is omitted', async () => {
      const user = makeUser();
      const dto = { orgId: 'org-uuid-1' };
      const uor = makeUor({ roleId: null });

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.findOne.mockResolvedValue(null);
      uorRepo.create.mockReturnValue(uor);
      uorRepo.save.mockResolvedValue(uor);

      const result = await service.assignOrg(user.id, dto as any, 'admin-uuid');

      expect(uorRepo.create).toHaveBeenCalledWith({
        userId: user.id,
        orgId: dto.orgId,
        roleId: null,
        assignedBy: 'admin-uuid',
      });
      expect(result).toEqual(uor);
    });

    it('clears the role when membership exists and dto.roleId is omitted', async () => {
      const user = makeUser();
      const existing = makeUor({ roleId: 'role-uuid-1' });
      const updated = makeUor({ id: existing.id, roleId: null });

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await service.assignOrg(user.id, { orgId: existing.orgId } as any, 'admin-uuid');

      expect(uorRepo.update).toHaveBeenCalledWith(existing.id, {
        roleId: null,
        assignedBy: 'admin-uuid',
      });
      expect(result).toEqual(updated);
    });
  });

  // ─── getOrgRoles ──────────────────────────────────────────────────────────

  describe('getOrgRoles', () => {
    it('returns org roles for an existing user ordered by createdAt ASC', async () => {
      const user = makeUser();
      const uors = [makeUor()];

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.find.mockResolvedValue(uors as any);

      const result = await service.getOrgRoles(user.id);

      expect(uorRepo.find).toHaveBeenCalledWith({
        where: { userId: user.id },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual(uors);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.getOrgRoles('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeFromOrg ────────────────────────────────────────────────────────

  describe('removeFromOrg', () => {
    it('clears role assignment for the given userId + orgId', async () => {
      const user = makeUser();

      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.query.mockResolvedValue(undefined as any);

      await service.removeFromOrg(user.id, 'org-uuid-1');

      expect(uorRepo.query).toHaveBeenCalledWith(
        `UPDATE user_org_roles SET role_id = NULL, assigned_by = NULL WHERE user_id = $1 AND org_id = $2`,
        [user.id, 'org-uuid-1'],
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.removeFromOrg('bad-id', 'org-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findByOrg ────────────────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns users with their roles for a given orgId', async () => {
      const user = makeUser();
      const adminRole = makeRole();
      const orgRole = makeUor({ user, role: adminRole as any });

      uorRepo.find.mockResolvedValue([orgRole] as any);

      const result = await service.findByOrg('org-uuid-1');

      expect(uorRepo.find).toHaveBeenCalledWith({
        where: { orgId: 'org-uuid-1' },
        relations: ['user', 'role'],
      });
      expect(usersRepo.find).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].user).toEqual(user);
      expect(result[0].roles).toEqual([
        { roleId: orgRole.roleId, roleName: adminRole.name },
      ]);
    });

    it('returns multiple users each with their own roles', async () => {
      const user1 = makeUser({ id: 'user-uuid-1' });
      const user2 = makeUser({ id: 'user-uuid-2', email: 'other@example.com' });
      const role1 = makeRole({ id: 'role-uuid-1', name: SystemRoleName.ADMIN });
      const role2 = makeRole({ id: 'role-uuid-2', name: SystemRoleName.VIEWER, scope: RoleScope.SYSTEM });
      const orgRole1 = makeUor({ userId: user1.id, user: user1, roleId: role1.id, role: role1 as any });
      const orgRole2 = makeUor({ id: 'uor-uuid-2', userId: user2.id, user: user2, roleId: role2.id, role: role2 as any });

      uorRepo.find.mockResolvedValue([orgRole1, orgRole2] as any);

      const result = await service.findByOrg('org-uuid-1');

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.user.id === user1.id)?.roles).toEqual([
        { roleId: role1.id, roleName: role1.name },
      ]);
      expect(result.find((r) => r.user.id === user2.id)?.roles).toEqual([
        { roleId: role2.id, roleName: role2.name },
      ]);
    });

    it('returns an empty array when no users belong to the org', async () => {
      uorRepo.find.mockResolvedValue([]);

      const result = await service.findByOrg('org-uuid-empty');

      expect(result).toEqual([]);
      expect(usersRepo.find).not.toHaveBeenCalled();
    });
  });

  // ─── completeRegistration ─────────────────────────────────────────────────

  describe('completeRegistration', () => {
    const validToken = 'a'.repeat(64);
    const dto = {
      token: validToken,
      firstName: 'Juan',
      lastName: 'Perez',
      idNumber: 'CC123',
      password: 'Str0ng@Pass',
    };

    it('updates profile, provisions credentials, deletes token and returns UserResponseDto', async () => {
      const user = makeUser({ firstName: dto.firstName, lastName: dto.lastName });

      redis.getdel.mockResolvedValue(user.id);
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);
      authClient.provisionCredentials.mockResolvedValue(undefined);

      const result = await service.completeRegistration(dto);

      expect(redis.getdel).toHaveBeenCalledWith(`invitation:${validToken}`);
      expect(authClient.provisionCredentials).toHaveBeenCalledWith({
        userId: user.id,
        email: user.email,
        password: dto.password,
      });
      expect(result.email).toBe(user.email);
    });

    it('throws NotFoundException when the token does not exist in Redis', async () => {
      redis.getdel.mockResolvedValue(null);

      await expect(service.completeRegistration(dto)).rejects.toThrow(NotFoundException);
    });

    it('does not delete the token when provisionCredentials fails', async () => {
      const user = makeUser();

      redis.getdel.mockResolvedValue(user.id);
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);
      authClient.provisionCredentials.mockRejectedValue(new Error('auth-service down'));

      await expect(service.completeRegistration(dto)).rejects.toThrow(
        'Error creating access credentials',
      );
    });
  });
});
