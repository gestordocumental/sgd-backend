import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RegistrationStatus, User } from './entities/user.entity';
import { SUPER_ADMIN_USER_ID, SuperAdminSeeder } from './super-admin.seeder';

describe('SuperAdminSeeder', () => {
  const makeBuilder = () => ({
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  });

  it('inserts the configured super admin user idempotently', async () => {
    const builder = makeBuilder();
    const userRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<User>;
    const config = {
      get: jest.fn().mockReturnValue('admin@example.com'),
    } as unknown as ConfigService;
    const seeder = new SuperAdminSeeder(userRepo, config);
    const logSpy = jest.spyOn((seeder as any).logger, 'log').mockImplementation();

    await seeder.onApplicationBootstrap();

    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.into).toHaveBeenCalledWith(User);
    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SUPER_ADMIN_USER_ID,
        email: 'admin@example.com',
        firstName: 'Super',
        lastName: 'Admin',
        isActive: true,
        isSuperAdmin: true,
        registrationStatus: RegistrationStatus.ACTIVE,
      }),
    );
    expect(builder.orIgnore).toHaveBeenCalledTimes(1);
    expect(builder.execute).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Super admin seeded');
  });

  it('throws when SUPER_ADMIN_EMAIL is not configured', async () => {
    const userRepo = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<User>;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const seeder = new SuperAdminSeeder(userRepo, config);

    await expect(seeder.onApplicationBootstrap()).rejects.toThrow(
      'SUPER_ADMIN_EMAIL is required for super-admin seeding',
    );
    expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
