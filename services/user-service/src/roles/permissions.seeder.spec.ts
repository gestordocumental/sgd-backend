import { Repository } from 'typeorm';
import { Permission, PermissionAction, PermissionModule } from './entities/permission.entity';
import { PermissionsSeeder } from './permissions.seeder';

describe('PermissionsSeeder', () => {
  it('upserts the permissions catalog on application bootstrap', async () => {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<Permission>;
    const seeder = new PermissionsSeeder(repository);
    const logSpy = jest.spyOn((seeder as any).logger, 'log').mockImplementation();

    await seeder.onApplicationBootstrap();

    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.into).toHaveBeenCalledWith(Permission);
    expect(builder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          module: PermissionModule.DOCUMENTS,
          action: PermissionAction.READ,
          description: 'View documents',
        },
        {
          module: PermissionModule.USERS,
          action: PermissionAction.MANAGE,
          description: 'Full user management',
        },
      ]),
    );
    expect(builder.orUpdate).toHaveBeenCalledWith(['description'], ['module', 'action']);
    expect(builder.execute).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Permissions catalog synced \(\d+ entries\)$/));
  });
});
