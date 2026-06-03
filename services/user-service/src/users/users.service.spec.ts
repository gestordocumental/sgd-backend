import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, HttpException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { UsersService } from './users.service';
import { User, RegistrationStatus } from './entities/user.entity';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { Role, RoleScope, SystemRoleName } from '../roles/entities/role.entity';
import { AuthClientService } from '../auth-client/auth-client.service';
import { OrgClientService } from '../common/org-client/org-client.service';
import { KafkaProducerService } from '@sgd/common';

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
  removedAt: null,
  isOptionalReviewer: false,
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
  let orgClient: jest.Mocked<Pick<OrgClientService, 'validateOrgStructure' | 'resolveNamesById'>>;

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
            findBy: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
            restore: jest.fn(),
            createQueryBuilder: jest.fn(),
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
            createQueryBuilder: jest.fn(),
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
            revokeAllTokens: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: OrgClientService,
          useValue: {
            validateOrgStructure: jest.fn().mockResolvedValue(undefined),
            resolveNamesById:     jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    usersRepo = module.get(getRepositoryToken(User));
    uorRepo = module.get(getRepositoryToken(UserOrgRole));
    roleRepo = module.get(getRepositoryToken(Role));
    authClient = module.get(AuthClientService);
    orgClient = module.get(OrgClientService);
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
      usersRepo.findAndCount.mockResolvedValue([users, users.length]);

      const result = await service.findAll();

      expect(usersRepo.findAndCount).toHaveBeenCalledWith({
        take: 100,
        skip: 0,
        order: { createdAt: 'DESC' },
        withDeleted: true,
      });
      expect(result).toEqual({ data: users, total: users.length });
    });

    it('returns an empty array when there are no users', async () => {
      usersRepo.findAndCount.mockResolvedValue([[], 0]);

      expect(await service.findAll()).toEqual({ data: [], total: 0 });
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

    it('calls orgClientService.validateOrgStructure when departamentoId is being set', async () => {
      const user = makeUser();
      const dto = { departamentoId: 'dept-uuid', areaId: 'area-uuid' };
      const updated = { ...user, ...dto };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated as any);

      await service.update(user.id, dto, undefined, 'org-uuid');

      expect(orgClient.validateOrgStructure).toHaveBeenCalledWith(
        'org-uuid',
        'dept-uuid',
        'area-uuid',
        undefined,
      );
    });

    it('throws BadRequestException when areaId is set but effective departamentoId is null', async () => {
      const user = makeUser({ departamentoId: null });
      usersRepo.findOne.mockResolvedValue(user);

      await expect(
        service.update(user.id, { areaId: 'area-uuid' }, undefined, 'org-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips org-structure validation when all three fields are being cleared (set to null)', async () => {
      const user = makeUser({ departamentoId: 'dept-uuid', areaId: 'area-uuid', cargoId: 'cargo-uuid' });
      const dto = { departamentoId: null, areaId: null, cargoId: null };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({ ...user, ...dto } as any);

      await service.update(user.id, dto, undefined, 'org-uuid');

      expect(orgClient.validateOrgStructure).not.toHaveBeenCalled();
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
        removedAt: null,
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
      uorRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.removeFromOrg(user.id, 'org-uuid-1');

      expect(uorRepo.update).toHaveBeenCalledWith(
        { userId: user.id, orgId: 'org-uuid-1' },
        { roleId: null, assignedBy: null, removedAt: expect.any(Date) },
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.removeFromOrg('bad-id', 'org-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── setOptionalReviewer ──────────────────────────────────────────────────

  describe('setOptionalReviewer', () => {
    it('throws NotFoundException when user is not a member of the org', async () => {
      uorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setOptionalReviewer('user-uuid-1', 'org-uuid-1', true),
      ).rejects.toThrow(NotFoundException);

      expect(uorRepo.update).not.toHaveBeenCalled();
    });

    it('updates isOptionalReviewer without emitting audit when actorId is absent', async () => {
      const uor = makeUor({ isOptionalReviewer: false });
      uorRepo.findOne.mockResolvedValue(uor);
      uorRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.setOptionalReviewer('user-uuid-1', 'org-uuid-1', true);

      expect(uorRepo.update).toHaveBeenCalledWith(
        { userId: 'user-uuid-1', orgId: 'org-uuid-1', removedAt: IsNull() },
        { isOptionalReviewer: true },
      );
      expect(kafkaProducer.emitSafe).not.toHaveBeenCalled();
    });

    it('emits audit log when actorId is provided', async () => {
      const user = makeUser();
      const uor = makeUor({ isOptionalReviewer: false });

      uorRepo.findOne.mockResolvedValue(uor);
      uorRepo.update.mockResolvedValue({ affected: 1 } as any);
      usersRepo.findOne.mockResolvedValue(user);

      await service.setOptionalReviewer('user-uuid-1', 'org-uuid-1', true, 'actor-uuid');

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: 'USER_OPTIONAL_REVIEWER_CHANGED',
          resourceId: 'user-uuid-1',
          metadata: {
            changes: { isOptionalReviewer: { from: false, to: true } },
          },
        }),
      );
    });
  });

  // ─── findByOrg ────────────────────────────────────────────────────────────

  describe('findByOrg', () => {
    function makeUorQb(rows: UserOrgRole[]) {
      const qb: Record<string, jest.Mock> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where:             jest.fn().mockReturnThis(),
        withDeleted:       jest.fn().mockReturnThis(),
        getMany:           jest.fn().mockResolvedValue(rows),
      };
      uorRepo.createQueryBuilder.mockReturnValue(qb as any);
      return qb;
    }

    it('returns users with their roles for a given orgId', async () => {
      const user = makeUser();
      const adminRole = makeRole();
      const orgRole = makeUor({ user, role: adminRole as any });

      makeUorQb([orgRole] as any);
      usersRepo.find.mockResolvedValue([]);

      const { data, total } = await service.findByOrg('org-uuid-1');

      expect(data).toHaveLength(1);
      expect(total).toBe(1);
      expect(data[0].user).toEqual(user);
      expect(data[0].roles).toEqual([
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

      makeUorQb([orgRole1, orgRole2] as any);
      usersRepo.find.mockResolvedValue([]);

      const { data, total } = await service.findByOrg('org-uuid-1');

      expect(total).toBe(2);
      expect(data.find((r) => r.user.id === user1.id)?.roles).toEqual([
        { roleId: role1.id, roleName: role1.name },
      ]);
      expect(data.find((r) => r.user.id === user2.id)?.roles).toEqual([
        { roleId: role2.id, roleName: role2.name },
      ]);
    });

    it('returns an empty data array and total=0 when no users belong to the org', async () => {
      makeUorQb([]);
      usersRepo.find.mockResolvedValue([]);

      const { data, total } = await service.findByOrg('org-uuid-empty');

      expect(data).toEqual([]);
      expect(total).toBe(0);
    });

    it('slices the result to the requested page and limit', async () => {
      const users = Array.from({ length: 10 }, (_, i) =>
        makeUor({
          id: `uor-${i}`,
          userId: `user-${i}`,
          user: makeUser({ id: `user-${i}`, email: `u${i}@example.com` }),
          role: makeRole() as any,
        }),
      );

      makeUorQb(users as any);
      usersRepo.find.mockResolvedValue([]);

      const { data, total } = await service.findByOrg('org-uuid-1', 2, 3);

      expect(total).toBe(10);
      expect(data).toHaveLength(3);
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

      const tokenHash = createHash('sha256').update(validToken).digest('hex');
      expect(redis.getdel).toHaveBeenCalledWith(`invitation:${tokenHash}`);
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

  // ─── findManyByIds ────────────────────────────────────────────────────────

  describe('findManyByIds', () => {
    it('returns empty array without hitting the repository when ids is empty', async () => {
      const result = await service.findManyByIds([]);
      expect(usersRepo.findBy).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('queries the repository by ids when the array is non-empty', async () => {
      const users = [makeUser()];
      usersRepo.findBy.mockResolvedValue(users);

      const result = await service.findManyByIds([users[0].id]);
      expect(usersRepo.findBy).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
      );
      expect(result).toEqual(users);
    });
  });

  // ─── uploadAvatar ─────────────────────────────────────────────────────────

  describe('uploadAvatar', () => {
    it('updates avatarUrl and returns the saved user', async () => {
      const url  = 'https://cdn.example.com/avatars/test.webp';
      const user = makeUser({ avatarUrl: null });
      const updated = { ...user, avatarUrl: url };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      const result = await service.uploadAvatar(user.id, url);

      expect(usersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: url }));
      expect(result.avatarUrl).toBe(url);
    });
  });

  // ─── remove (additional paths) ────────────────────────────────────────────

  describe('remove (additional paths)', () => {
    it('delegates to removeFromOrg when callerOrgId is provided', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.remove(user.id, 'org-uuid-1');

      expect(usersRepo.softRemove).not.toHaveBeenCalled();
      expect(uorRepo.update).toHaveBeenCalled();
    });

    it('emits audit log on global delete when actorId is provided', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.softRemove.mockResolvedValue(undefined as any);
      authClient.disableCredentials.mockResolvedValue(undefined);

      await service.remove(user.id, undefined, 'actor-uuid');

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: 'USER_DELETED', actorId: 'actor-uuid' }),
      );
    });
  });

  // ─── update (actorId audit paths) ─────────────────────────────────────────

  describe('update (actorId audit paths)', () => {
    it('emits audit log when actorId is provided and fields change', async () => {
      const user = makeUser({ firstName: 'Old' });
      const updated = { ...user, firstName: 'New' };

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      await service.update(user.id, { firstName: 'New' }, 'actor-uuid');

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: 'USER_UPDATED',
          actorId: 'actor-uuid',
          metadata: { changes: { firstName: { from: 'Old', to: 'New' } } },
        }),
      );
    });

    it('resolves org-structure names when departamentoId changes and orgId is provided', async () => {
      const user = makeUser({ departamentoId: 'old-dept', areaId: null, cargoId: null });
      const updated = { ...user, departamentoId: 'new-dept' };
      orgClient.resolveNamesById.mockResolvedValue({
        departamentoNombre: 'Finanzas',
        areaNombre: null,
        cargoNombre: null,
      });

      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(updated);

      await service.update(user.id, { departamentoId: 'new-dept' }, 'actor-uuid', 'org-uuid-1');

      const [calledOrgId, calledDeptId] = orgClient.resolveNamesById.mock.calls[0] ?? [];
      expect(calledOrgId).toBe('org-uuid-1');
      expect(calledDeptId).toBe('new-dept');
      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: 'USER_UPDATED' }),
      );
    });

    it('does not emit audit log when no fields actually change', async () => {
      const user = makeUser({ firstName: 'Same' });
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);

      await service.update(user.id, { firstName: 'Same' }, 'actor-uuid');

      expect(kafkaProducer.emitSafe).not.toHaveBeenCalled();
    });
  });

  // ─── getMyOrgRoles ────────────────────────────────────────────────────────

  describe('getMyOrgRoles', () => {
    it('returns active role assignments for the given user and org', async () => {
      const uors = [makeUor()];
      uorRepo.find.mockResolvedValue(uors as any);

      const result = await service.getMyOrgRoles('user-uuid-1', 'org-uuid-1');

      expect(uorRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-uuid-1', orgId: 'org-uuid-1' }),
        }),
      );
      expect(result).toEqual(uors);
    });

    it('returns empty array when no active roles exist in the org', async () => {
      uorRepo.find.mockResolvedValue([]);
      expect(await service.getMyOrgRoles('user-uuid-1', 'org-uuid-99')).toEqual([]);
    });
  });

  // ─── getEffectivePermissions ──────────────────────────────────────────────

  describe('getEffectivePermissions', () => {
    it('returns flat deduplicated permissions from all org roles', async () => {
      const uor = makeUor({
        role: {
          ...makeRole(),
          permissions: [
            { module: 'USERS', action: 'READ' },
            { module: 'USERS', action: 'WRITE' },
            { module: 'USERS', action: 'READ' }, // duplicate — must be deduped
          ],
        } as any,
      });
      uorRepo.find.mockResolvedValue([uor] as any);

      const result = await service.getEffectivePermissions('user-uuid-1', 'org-uuid-1');

      expect(result).toEqual([
        { module: 'USERS', action: 'READ' },
        { module: 'USERS', action: 'WRITE' },
      ]);
    });

    it('returns empty array when user has no roles in the org', async () => {
      uorRepo.find.mockResolvedValue([]);
      expect(await service.getEffectivePermissions('user-uuid-1', 'org-uuid-1')).toEqual([]);
    });
  });

  // ─── removeAllFromOrg ─────────────────────────────────────────────────────

  describe('removeAllFromOrg', () => {
    it('executes a query builder update to clear all memberships for the org', async () => {
      const qb = {
        update:   jest.fn().mockReturnThis(),
        set:      jest.fn().mockReturnThis(),
        where:    jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute:  jest.fn().mockResolvedValue({ affected: 3 }),
      };
      uorRepo.createQueryBuilder.mockReturnValue(qb as any);

      await service.removeAllFromOrg('org-uuid-1');

      expect(qb.where).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ orgId: 'org-uuid-1' }),
      );
      expect(qb.execute).toHaveBeenCalled();
    });
  });

  // ─── removeFromOrg (actorId paths) ────────────────────────────────────────

  describe('removeFromOrg (actorId paths)', () => {
    it('emits audit log when actorId is provided', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      uorRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.removeFromOrg(user.id, 'org-uuid-1', 'actor-uuid');

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: 'USER_REMOVED_FROM_ORG', actorId: 'actor-uuid' }),
      );
    });

    it('throws NotFoundException when user is not assigned to the org', async () => {
      usersRepo.findOne.mockResolvedValue(makeUser());
      uorRepo.update.mockResolvedValue({ affected: 0 } as any);

      await expect(service.removeFromOrg('user-uuid-1', 'org-uuid-99')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── completeRegistration (HttpException paths) ───────────────────────────

  describe('completeRegistration (HttpException paths)', () => {
    const validToken = 'a'.repeat(64);
    const dto = {
      token: validToken,
      firstName: 'Juan',
      lastName: 'Perez',
      idNumber: 'CC123',
      password: 'Str0ng@Pass',
    };

    it('wraps a 4xx HttpException as HttpException("Invalid registration data")', async () => {
      const user = makeUser();
      redis.getdel.mockResolvedValue(user.id);
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);
      authClient.provisionCredentials.mockRejectedValue(new BadRequestException('weak password'));

      const p = service.completeRegistration(dto);
      await expect(p).rejects.toBeInstanceOf(HttpException);
      await expect(p).rejects.toThrow('Invalid registration data');
    });

    it('wraps a 5xx HttpException as InternalServerErrorException', async () => {
      const user = makeUser();
      redis.getdel.mockResolvedValue(user.id);
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);
      authClient.provisionCredentials.mockRejectedValue(
        new InternalServerErrorException('auth-service fail'),
      );

      const p = service.completeRegistration(dto);
      await expect(p).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(p).rejects.toThrow('Error creating access credentials');
    });
  });

  // ─── findByOrg (explicit membership only) ────────────────────────────────

  describe('findByOrg (explicit membership only)', () => {
    it('does not include super admins without explicit org membership', async () => {
      const qb: Record<string, jest.Mock> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where:             jest.fn().mockReturnThis(),
        withDeleted:       jest.fn().mockReturnThis(),
        getMany:           jest.fn().mockResolvedValue([]),
      };
      uorRepo.createQueryBuilder.mockReturnValue(qb as any);

      const { data, total } = await service.findByOrg('org-uuid-1');

      expect(total).toBe(0);
      expect(data).toEqual([]);
      expect(usersRepo.find).not.toHaveBeenCalled();
    });

    it('includes a super admin that has an explicit user_org_roles record', async () => {
      const superAdmin = makeUser({
        id: 'sa-uuid-1',
        email: 'sa@example.com',
        isSuperAdmin: true,
        registrationStatus: RegistrationStatus.ACTIVE,
      });
      const orgRole = {
        userId: superAdmin.id,
        orgId: 'org-uuid-1',
        roleId: 'role-uuid-1',
        role: { id: 'role-uuid-1', name: 'ADMIN' },
        user: superAdmin,
        removedAt: null,
        isOptionalReviewer: false,
      };

      const qb: Record<string, jest.Mock> = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where:             jest.fn().mockReturnThis(),
        withDeleted:       jest.fn().mockReturnThis(),
        getMany:           jest.fn().mockResolvedValue([orgRole]),
      };
      uorRepo.createQueryBuilder.mockReturnValue(qb as any);

      const { data, total } = await service.findByOrg('org-uuid-1');

      expect(total).toBe(1);
      expect(data[0].user.id).toBe(superAdmin.id);
      expect(data[0].roles).toEqual([{ roleId: 'role-uuid-1', roleName: 'ADMIN' }]);
    });
  });

  // ─── getCountsByOrg ───────────────────────────────────────────────────────

  describe('getCountsByOrg', () => {
    it('returns counts grouped by org with values parsed as numbers', async () => {
      const qb = {
        innerJoin:  jest.fn().mockReturnThis(),
        select:     jest.fn().mockReturnThis(),
        addSelect:  jest.fn().mockReturnThis(),
        where:      jest.fn().mockReturnThis(),
        andWhere:   jest.fn().mockReturnThis(),
        groupBy:    jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { orgId: 'org-1', total: '10', active: '8' },
        ]),
      };
      uorRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getCountsByOrg();

      expect(result).toEqual([
        { orgId: 'org-1', total: 10, active: 8, inactive: 2 },
      ]);
    });
  });

  // ─── findByPosition ───────────────────────────────────────────────────────

  describe('findByPosition', () => {
    function makeUsersQb(users: User[]) {
      const qb: Record<string, jest.Mock> = {
        innerJoin: jest.fn().mockReturnThis(),
        where:     jest.fn().mockReturnThis(),
        andWhere:  jest.fn().mockReturnThis(),
        getMany:   jest.fn().mockResolvedValue(users),
      };
      usersRepo.createQueryBuilder.mockReturnValue(qb as any);
      return qb;
    }

    it('returns users matching all provided filters', async () => {
      const user = makeUser();
      makeUsersQb([user]);

      const result = await service.findByPosition('org-uuid-1', {
        departamentoId: 'dept-uuid',
        cargoId:        'cargo-uuid',
        areaId:         'area-uuid',
      });

      expect(result).toEqual([
        { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
      ]);
    });

    it('filters by area_id IS NULL when areaId is explicitly null', async () => {
      const user = makeUser();
      const qb = makeUsersQb([user]);

      await service.findByPosition('org-uuid-1', { departamentoId: 'dept-uuid', areaId: null });

      expect(qb.andWhere).toHaveBeenCalledWith('u.area_id IS NULL');
    });

    it('returns empty array when no users match', async () => {
      makeUsersQb([]);
      expect(await service.findByPosition('org-uuid-1', {})).toEqual([]);
    });
  });
});
