import { AUTH_KEY, Auth, SuperAdminOnly } from './auth.decorator';
import { SetMetadata } from '@nestjs/common';

jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  SetMetadata: jest.fn().mockReturnValue(() => {}),
}));

describe('auth.decorator', () => {
  beforeEach(() => jest.clearAllMocks());

  it('Auth() calls SetMetadata with superAdminOnly=false', () => {
    Auth();
    expect(SetMetadata).toHaveBeenCalledWith(AUTH_KEY, { orgMember: false, superAdminOnly: false });
  });

  it('SuperAdminOnly() calls SetMetadata with superAdminOnly=true', () => {
    SuperAdminOnly();
    expect(SetMetadata).toHaveBeenCalledWith(AUTH_KEY, { orgMember: false, superAdminOnly: true });
  });
});
