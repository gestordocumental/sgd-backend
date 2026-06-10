import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, RegistrationStatus } from './entities/user.entity';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { UserOrgRoleResponseDto } from './dto/user-org-role-response.dto';
import { UserWithOrgRolesDto } from './dto/user-with-org-roles.dto';
import { StorageService } from '../common/storage/storage.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

const INTERNAL_TOKEN = 'super-secret-token';

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
  registrationStatus: overrides.registrationStatus ?? RegistrationStatus.ACTIVE,
  avatarUrl: null,
  isSuperAdmin: false,
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

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findAllSuperAdmin: jest.fn(),
            findOne: jest.fn(),
            findByEmail: jest.fn(),
            findByOrg: jest.fn(),
            getCountsByOrg: jest.fn(),
            getMyOrgRoles: jest.fn(),
            uploadAvatar: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            restore: jest.fn(),
            getCompanies: jest.fn(),
            provision: jest.fn(),
            setSuperAdmin: jest.fn(),
            assignOrg: jest.fn(),
            getOrgRoles: jest.fn(),
            removeFromOrg: jest.fn(),
            setOptionalReviewer: jest.fn(),
            completeRegistration: jest.fn(),
            resendInvitation: jest.fn(),
            removeAllFromOrg: jest.fn(),
            getEffectivePermissions: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(INTERNAL_TOKEN),
            get: jest.fn().mockReturnValue(INTERNAL_TOKEN),
          },
        },
        {
          provide: getRepositoryToken(UserOrgRole),
          useValue: { find: jest.fn() },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            extractKey: jest.fn(),
            delete: jest.fn(),
            upload: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(UsersController);
    usersService = module.get(UsersService);
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns a UserResponseDto with invitationToken after creating a user', async () => {
      const caller = { sub: 'admin-uuid', companyId: 'org-uuid-1', isSuperAdmin: false };
      const dto = { email: 'new@example.com', position: 'Dev', orgId: 'org-uuid-1' };
      const user = makeUser({ email: dto.email, position: dto.position });
      const invitationToken = 'a'.repeat(64);

      usersService.create.mockResolvedValue({ user, invitationToken });

      const result = await controller.create(caller, dto as any);

      expect(usersService.create).toHaveBeenCalledWith(dto, caller.sub, caller.companyId);
      expect(result.email).toBe(user.email);
      expect(result.invitationToken).toBe(invitationToken);
    });

    it('propagates ConflictException from the service', async () => {
      const caller = { sub: 'admin-uuid', companyId: 'org-uuid-1', isSuperAdmin: false };

      usersService.create.mockRejectedValue(
        new ConflictException({ message: 'User already exists', userId: 'existing-id' }),
      );

      await expect(
        controller.create(caller, { email: 'x@x.com', orgId: 'org-uuid-1' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when a non-super-admin tries to create a super admin user', async () => {
      const caller = { sub: 'admin-uuid', companyId: 'org-uuid-1', isSuperAdmin: false };
      const dto = { email: 'super@example.com', isSuperAdmin: true };

      await expect(controller.create(caller, dto as any)).rejects.toThrow(
        new ForbiddenException('Only super admins can grant super admin privileges'),
      );

      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a non-super-admin tries to assign a user to a different org', async () => {
      const caller = { sub: 'admin-uuid', companyId: 'org-uuid-1', isSuperAdmin: false };
      const dto = { email: 'other@example.com', orgId: 'org-uuid-999' };

      await expect(controller.create(caller, dto as any)).rejects.toThrow(
        new ForbiddenException('You can only assign users to your own organization'),
      );

      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  // ─── GET / ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns a paginated response with UserResponseDto items', async () => {
      const users = [makeUser(), makeUser({ id: 'user-uuid-2', email: 'other@example.com' })];
      usersService.findAll.mockResolvedValue({ data: users, nextCursor: null, hasMore: false });

      const result = await controller.findAll(100);

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      result.data.forEach((r) => expect(r).toBeInstanceOf(UserResponseDto));
    });

    it('returns an empty data array when there are no users', async () => {
      usersService.findAll.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      const result = await controller.findAll(100);
      expect(result.data).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  // ─── GET /by-email/:email ─────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('returns a UserResponseDto for the matching email', async () => {
      const user = makeUser();
      usersService.findByEmail.mockResolvedValue(user);

      const result = await controller.findByEmail(user.email);

      expect(usersService.findByEmail).toHaveBeenCalledWith(user.email);
      expect(result).toBeInstanceOf(UserResponseDto);
    });

    it('propagates NotFoundException from the service', async () => {
      usersService.findByEmail.mockRejectedValue(new NotFoundException());

      await expect(controller.findByEmail('ghost@example.com')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /by-org/:orgId ───────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns cursor-paginated UserWithOrgRolesDto items for the given orgId', async () => {
      const user = makeUser();
      const roles = [{ roleId: 'role-uuid-1', roleName: 'ADMIN' }];

      usersService.findByOrg.mockResolvedValue({ data: [{ user, roles, orgRemovedAt: null, isOptionalReviewer: false }], nextCursor: null, hasMore: false });

      const result = await controller.findByOrg('org-uuid-1', 500);

      expect(usersService.findByOrg).toHaveBeenCalledWith('org-uuid-1', 500, undefined);
      expect(result.hasMore).toBe(false);
      expect(result.data).toHaveLength(1);
      result.data.forEach((r) => expect(r).toBeInstanceOf(UserWithOrgRolesDto));
      expect(result.data[0].roles).toEqual(roles);
      expect(result.data[0].isOptionalReviewer).toBe(false);
    });

    it('returns empty data array when no users belong to the org', async () => {
      usersService.findByOrg.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      const result = await controller.findByOrg('org-uuid-empty', 500);

      expect(usersService.findByOrg).toHaveBeenCalledWith('org-uuid-empty', 500, undefined);
      expect(result.data).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a UserResponseDto for the given id', async () => {
      const user = makeUser();
      usersService.findOne.mockResolvedValue(user);

      const result = await controller.findOne(user.id);

      expect(usersService.findOne).toHaveBeenCalledWith(user.id);
      expect(result).toBeInstanceOf(UserResponseDto);
    });

    it('propagates NotFoundException from the service', async () => {
      usersService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /:id/companies ───────────────────────────────────────────────────

  describe('getCompanies', () => {
    it('returns orgIds when the internal token is valid', () => {
      usersService.getCompanies.mockResolvedValue(['org-1', 'org-2']);

      const result = controller.getCompanies(INTERNAL_TOKEN, 'user-uuid-1');

      expect(usersService.getCompanies).toHaveBeenCalledWith('user-uuid-1');
      return expect(result).resolves.toEqual(['org-1', 'org-2']);
    });

    it('throws UnauthorizedException when the internal token is missing', () => {
      expect(() => controller.getCompanies('', 'user-uuid-1')).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the internal token is wrong', () => {
      expect(() => controller.getCompanies('wrong-token', 'user-uuid-1')).toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── PATCH /:id ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('returns an updated UserResponseDto', async () => {
      const user = makeUser();
      const dto = { firstName: 'Jane' };
      const updated = { ...user, ...dto };

      usersService.update.mockResolvedValue(updated);

      const caller = { sub: 'caller-id', companyId: 'org-uuid-1' };
      const result = await controller.update(caller as any, user.id, dto as any);

      expect(usersService.update).toHaveBeenCalledWith(user.id, dto, caller.sub, caller.companyId);
      expect(result).toBeInstanceOf(UserResponseDto);
      expect(result.firstName).toBe('Jane');
    });
  });

  // ─── DELETE /:id ──────────────────────────────────────────────────────────

  describe('remove', () => {
    it('passes companyId from JWT when caller has org context (org-scoped delete)', async () => {
      usersService.remove.mockResolvedValue(undefined);

      await controller.remove({ sub: 'caller-id', companyId: 'org-uuid' } as any, 'user-uuid-1');

      expect(usersService.remove).toHaveBeenCalledWith('user-uuid-1', 'org-uuid', 'caller-id');
    });

    it('passes undefined companyId when caller is super admin (global delete)', async () => {
      usersService.remove.mockResolvedValue(undefined);

      await controller.remove({ sub: 'caller-id', isSuperAdmin: true } as any, 'user-uuid-1');

      expect(usersService.remove).toHaveBeenCalledWith('user-uuid-1', undefined, 'caller-id');
    });
  });

  // ─── POST /:id/restore ────────────────────────────────────────────────────

  describe('restore', () => {
    it('returns a UserResponseDto after restoring', async () => {
      const user = makeUser();
      usersService.restore.mockResolvedValue(user);

      const result = await controller.restore({ sub: 'caller-id' } as any, user.id);

      expect(usersService.restore).toHaveBeenCalledWith(user.id, 'caller-id');
      expect(result).toBeInstanceOf(UserResponseDto);
    });
  });

  // ─── POST /:id/provision ──────────────────────────────────────────────────

  describe('provision', () => {
    it('delegates to service.provision and returns the result', async () => {
      const dto = { password: 'Str0ng@Pass' };
      usersService.provision.mockResolvedValue({ ok: true });

      const result = await controller.provision('user-uuid-1', dto as any);

      expect(usersService.provision).toHaveBeenCalledWith('user-uuid-1', dto);
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── PATCH /:id/super-admin ───────────────────────────────────────────────

  describe('setSuperAdmin', () => {
    it('delegates to service.setSuperAdmin and returns a UserResponseDto', async () => {
      const user = makeUser({ isSuperAdmin: true });
      const dto = { enabled: true };

      usersService.setSuperAdmin.mockResolvedValue(user);

      // _caller (from @RequireSuperAdmin()) is passed as undefined in unit tests
      const result = await controller.setSuperAdmin(
        undefined as any,
        { sub: 'caller-id' } as any,
        user.id,
        dto,
      );

      expect(usersService.setSuperAdmin).toHaveBeenCalledWith(user.id, dto.enabled, 'caller-id');
      expect(result).toBeInstanceOf(UserResponseDto);
      expect(result.isSuperAdmin).toBe(true);
    });
  });

  // ─── POST /:id/orgs ───────────────────────────────────────────────────────

  describe('assignOrg', () => {
    it('returns a UserOrgRoleResponseDto after assigning org', async () => {
      const uor = makeUor();
      const dto = { orgId: 'org-uuid-1', roleId: 'role-uuid-1' };

      usersService.assignOrg.mockResolvedValue(uor);

      const result = await controller.assignOrg('caller-uuid', 'user-uuid-1', dto as any);

      expect(usersService.assignOrg).toHaveBeenCalledWith('user-uuid-1', dto, 'caller-uuid');
      expect(result).toBeInstanceOf(UserOrgRoleResponseDto);
    });
  });

  // ─── GET /:id/orgs ────────────────────────────────────────────────────────

  describe('getOrgRoles', () => {
    it('returns an array of UserOrgRoleResponseDto', async () => {
      const uors = [makeUor()];
      usersService.getOrgRoles.mockResolvedValue(uors);

      const result = await controller.getOrgRoles('user-uuid-1');

      expect(result).toHaveLength(1);
      result.forEach((r) => expect(r).toBeInstanceOf(UserOrgRoleResponseDto));
    });
  });

  // ─── DELETE /:id/orgs/:orgId ──────────────────────────────────────────────

  describe('removeFromOrg', () => {
    it('delegates to service.removeFromOrg', async () => {
      usersService.removeFromOrg.mockResolvedValue(undefined);

      await controller.removeFromOrg({ sub: 'caller-id' } as any, 'user-uuid-1', 'org-uuid-1');

      expect(usersService.removeFromOrg).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1', 'caller-id');
    });
  });

  // ─── GET /admin/counts-by-org ─────────────────────────────────────────────

  describe('countsByOrg', () => {
    it('delegates to service.getCountsByOrg', async () => {
      const counts = [{ orgId: 'org-1', total: 10, active: 8, inactive: 2 }];
      usersService.getCountsByOrg.mockResolvedValue(counts);

      const result = await controller.countsByOrg(undefined as any);

      expect(usersService.getCountsByOrg).toHaveBeenCalled();
      expect(result).toEqual(counts);
    });
  });

  // ─── GET /super-admins ────────────────────────────────────────────────────

  describe('findAllSuperAdmin', () => {
    it('returns paginated UserResponseDto items for super admins', async () => {
      const users = [makeUser({ isSuperAdmin: true })];
      usersService.findAllSuperAdmin.mockResolvedValue({ data: users, nextCursor: null, hasMore: false });

      const result = await controller.findAllSuperAdmin(20);

      expect(usersService.findAllSuperAdmin).toHaveBeenCalledWith(20, undefined, undefined, undefined);
      expect(result.hasMore).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toBeInstanceOf(UserResponseDto);
    });

    it('throws BadRequestException when status is not a valid enum value', async () => {
      await expect(
        controller.findAllSuperAdmin(20, undefined, undefined, 'unknown' as any),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.findAllSuperAdmin).not.toHaveBeenCalled();
    });
  });

  // ─── GET /me/org-roles ────────────────────────────────────────────────────

  describe('getMyOrgRoles', () => {
    it('returns UserOrgRoleResponseDto array for authenticated user', async () => {
      const uors = [makeUor()];
      usersService.getMyOrgRoles.mockResolvedValue(uors);

      const result = await controller.getMyOrgRoles({
        sub: 'user-uuid-1',
        companyId: 'org-uuid-1',
      } as any);

      expect(usersService.getMyOrgRoles).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1');
      expect(result).toHaveLength(1);
      result.forEach((r) => expect(r).toBeInstanceOf(UserOrgRoleResponseDto));
    });

    it('throws UnauthorizedException when sub claim is missing', () => {
      expect(() =>
        controller.getMyOrgRoles({ sub: '', companyId: 'org-uuid-1' } as any),
      ).toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when companyId is missing', () => {
      expect(() =>
        controller.getMyOrgRoles({ sub: 'user-uuid-1', companyId: undefined } as any),
      ).toThrow(ForbiddenException);
    });
  });

  // ─── DELETE /internal/orgs/:orgId/users ──────────────────────────────────

  describe('removeAllFromOrg', () => {
    it('delegates to service.removeAllFromOrg when internal token is valid', async () => {
      usersService.removeAllFromOrg.mockResolvedValue(undefined);

      await controller.removeAllFromOrg(INTERNAL_TOKEN, 'org-uuid-1');

      expect(usersService.removeAllFromOrg).toHaveBeenCalledWith('org-uuid-1');
    });

    it('throws UnauthorizedException when internal token is invalid', async () => {
      await expect(controller.removeAllFromOrg('wrong-token', 'org-uuid-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── GET /:id/effective-permissions ──────────────────────────────────────

  describe('getEffectivePermissions', () => {
    it('returns permissions when token and companyId are valid', async () => {
      const perms = [{ module: 'USERS', action: 'READ' }];
      usersService.getEffectivePermissions.mockResolvedValue(perms);

      const result = await controller.getEffectivePermissions(INTERNAL_TOKEN, 'user-uuid-1', 'org-uuid-1');

      expect(usersService.getEffectivePermissions).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1');
      expect(result).toEqual(perms);
    });

    it('throws UnauthorizedException when the internal token is invalid', async () => {
      await expect(
        controller.getEffectivePermissions('wrong-token', 'user-uuid-1', 'org-uuid-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── POST /:id/resend-invitation ─────────────────────────────────────────

  describe('resendInvitation', () => {
    it('passes callerOrgId from JWT for non-super-admin callers', async () => {
      const user = makeUser();
      const invitationToken = 'b'.repeat(64);
      usersService.resendInvitation.mockResolvedValue({ user, invitationToken });

      const result = await controller.resendInvitation(
        { sub: 'admin', companyId: 'org-uuid-1', isSuperAdmin: false } as any,
        'user-uuid-1',
      );

      expect(usersService.resendInvitation).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1');
      expect(result.invitationToken).toBe(invitationToken);
    });

    it('passes undefined callerOrgId for super admin callers', async () => {
      const user = makeUser();
      usersService.resendInvitation.mockResolvedValue({ user, invitationToken: 'x'.repeat(64) });

      await controller.resendInvitation(
        { sub: 'sa', isSuperAdmin: true } as any,
        'user-uuid-1',
      );

      expect(usersService.resendInvitation).toHaveBeenCalledWith('user-uuid-1', undefined);
    });
  });

  // ─── POST /complete-registration ─────────────────────────────────────────

  describe('completeRegistration', () => {
    it('delegates to service and returns UserResponseDto', async () => {
      const user = makeUser({ registrationStatus: RegistrationStatus.ACTIVE });
      usersService.completeRegistration.mockResolvedValue(UserResponseDto.from(user));

      const dto = { token: 'a'.repeat(64), firstName: 'Juan', lastName: 'Perez', idNumber: 'CC123', password: 'Str0ng@Pass' };
      const result = await controller.completeRegistration(dto as any);

      expect(usersService.completeRegistration).toHaveBeenCalledWith(dto);
      expect(result).toBeInstanceOf(UserResponseDto);
    });
  });

  // ─── PATCH /:id/orgs/:orgId/optional-reviewer ────────────────────────────

  describe('setOptionalReviewer', () => {
    it('delegates to service when caller is in the same org', async () => {
      usersService.setOptionalReviewer.mockResolvedValue(undefined);

      await controller.setOptionalReviewer(
        { sub: 'caller-id', companyId: 'org-uuid-1', isSuperAdmin: false } as any,
        'user-uuid-1',
        'org-uuid-1',
        { value: true } as any,
      );

      expect(usersService.setOptionalReviewer).toHaveBeenCalledWith(
        'user-uuid-1', 'org-uuid-1', true, 'caller-id',
      );
    });

    it('throws ForbiddenException when non-super-admin tries to update a different org', () => {
      expect(() =>
        controller.setOptionalReviewer(
          { sub: 'caller-id', companyId: 'org-uuid-1', isSuperAdmin: false } as any,
          'user-uuid-1',
          'org-uuid-DIFFERENT',
          { value: true } as any,
        ),
      ).toThrow(ForbiddenException);

      expect(usersService.setOptionalReviewer).not.toHaveBeenCalled();
    });

    it('allows super admin to update any org without ForbiddenException', async () => {
      usersService.setOptionalReviewer.mockResolvedValue(undefined);

      await controller.setOptionalReviewer(
        { sub: 'sa-id', companyId: 'org-uuid-1', isSuperAdmin: true } as any,
        'user-uuid-1',
        'org-uuid-DIFFERENT',
        { value: false } as any,
      );

      expect(usersService.setOptionalReviewer).toHaveBeenCalled();
    });
  });
});
