import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Credential, CredentialStatus } from './entities/credential.entity';
import { CredentialSeeder } from './credential.seeder';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-admin-password'),
}));

describe('CredentialSeeder', () => {
  let repo: Record<'findOne' | 'create' | 'save', jest.Mock>;
  let config: Record<'get', jest.Mock>;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((value) => value as Credential),
      save: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      get: jest.fn((key: string) => ({
        SUPER_ADMIN_EMAIL: 'admin@example.com',
        SUPER_ADMIN_PASSWORD: 'Admin1234!',
      })[key]),
    };
  });

  it('creates the super admin credential when it does not exist', async () => {
    repo.findOne.mockResolvedValue(null);
    const seeder = new CredentialSeeder(
      repo as unknown as Repository<Credential>,
      config as unknown as ConfigService,
    );
    jest.spyOn((seeder as any).logger, 'log').mockImplementation();

    await seeder.onApplicationBootstrap();

    expect(repo.findOne).toHaveBeenCalledWith({
      where: [
        { userId: '00000000-0000-4000-8000-000000000001' },
        { email: 'admin@example.com' },
      ],
    });
    expect(bcrypt.hash).toHaveBeenCalledWith('Admin1234!', 10);
    expect(repo.create).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'admin@example.com',
      passwordHash: 'hashed-admin-password',
      status: CredentialStatus.ACTIVE,
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      email: 'admin@example.com',
      status: CredentialStatus.ACTIVE,
    }));
  });

  it('skips seeding when the credential already exists', async () => {
    repo.findOne.mockResolvedValue({ id: 'existing-credential' } as Credential);
    const seeder = new CredentialSeeder(
      repo as unknown as Repository<Credential>,
      config as unknown as ConfigService,
    );
    const logSpy = jest.spyOn((seeder as any).logger, 'log').mockImplementation();

    await seeder.onApplicationBootstrap();

    expect(repo.save).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Super admin credential already exists'));
  });

  it('throws when SUPER_ADMIN_EMAIL is missing', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'SUPER_ADMIN_PASSWORD' ? 'Admin1234!' : undefined
    ));
    const seeder = new CredentialSeeder(
      repo as unknown as Repository<Credential>,
      config as unknown as ConfigService,
    );

    await expect(seeder.onApplicationBootstrap()).rejects.toThrow(
      'SUPER_ADMIN_EMAIL is required for super-admin seeding',
    );
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('throws when SUPER_ADMIN_PASSWORD is missing', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'SUPER_ADMIN_EMAIL' ? 'admin@example.com' : undefined
    ));
    const seeder = new CredentialSeeder(
      repo as unknown as Repository<Credential>,
      config as unknown as ConfigService,
    );

    await expect(seeder.onApplicationBootstrap()).rejects.toThrow(
      'SUPER_ADMIN_PASSWORD is required for super-admin seeding',
    );
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
