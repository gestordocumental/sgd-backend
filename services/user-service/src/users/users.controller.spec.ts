import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { UserOrgRoleResponseDto } from './dto/user-org-role-response.dto';

// ─── Helpers ────────────────────────────────────────────────────────────────

const INTERNAL_TOKEN = 'super-secret-token';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-uuid-1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  idNumber: null,
  position: 'Developer',
  isActive: true,
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
            findOne: jest.fn(),
            findByEmail: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            restore: jest.fn(),
            getCompanies: jest.fn(),
            provision: jest.fn(),
            setSuperAdmin: jest.fn(),
            assignOrg: jest.fn(),
            getOrgRoles: jest.fn(),
            removeFromOrg: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(INTERNAL_TOKEN),
          },
        },
      ],
    }).compile();

    controller = module.get(UsersController);
    usersService = module.get(UsersService);
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns a UserResponseDto after creating a user', async () => {
      const dto = { email: 'new@example.com', position: 'Dev' };
      const user = makeUser(dto);

      usersService.create.mockResolvedValue(user);

      const result = await controller.create(dto as any);

      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(result).toBeInstanceOf(UserResponseDto);
      expect(result.email).toBe(user.email);
    });

    it('propagates ConflictException from the service', async () => {
      usersService.create.mockRejectedValue(
        new ConflictException({ message: 'User already exists', userId: 'existing-id' }),
      );

      await expect(controller.create({ email: 'x@x.com' } as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── GET / ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns an array of UserResponseDto', async () => {
      const users = [makeUser(), makeUser({ id: 'user-uuid-2', email: 'other@example.com' })];
      usersService.findAll.mockResolvedValue(users);

      const result = await controller.findAll();

      expect(result).toHaveLength(2);
      result.forEach((r) => expect(r).toBeInstanceOf(UserResponseDto));
    });

    it('returns an empty array when there are no users', async () => {
      usersService.findAll.mockResolvedValue([]);

      expect(await controller.findAll()).toEqual([]);
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

      const result = await controller.update(user.id, dto as any);

      expect(usersService.update).toHaveBeenCalledWith(user.id, dto);
      expect(result).toBeInstanceOf(UserResponseDto);
      expect(result.firstName).toBe('Jane');
    });
  });

  // ─── DELETE /:id ──────────────────────────────────────────────────────────

  describe('remove', () => {
    it('delegates to service.remove and returns void', async () => {
      usersService.remove.mockResolvedValue(undefined);

      await controller.remove('user-uuid-1');

      expect(usersService.remove).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ─── POST /:id/restore ────────────────────────────────────────────────────

  describe('restore', () => {
    it('returns a UserResponseDto after restoring', async () => {
      const user = makeUser();
      usersService.restore.mockResolvedValue(user);

      const result = await controller.restore(user.id);

      expect(usersService.restore).toHaveBeenCalledWith(user.id);
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
      const result = await controller.setSuperAdmin(undefined as any, user.id, dto);

      expect(usersService.setSuperAdmin).toHaveBeenCalledWith(user.id, dto.enabled);
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

      await controller.removeFromOrg('user-uuid-1', 'org-uuid-1');

      expect(usersService.removeFromOrg).toHaveBeenCalledWith('user-uuid-1', 'org-uuid-1');
    });
  });
});
