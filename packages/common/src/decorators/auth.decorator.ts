import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'auth_meta';

export interface AuthMeta {
  orgMember: boolean;
  superAdminOnly: boolean;
}

/** Requires a valid JWT from an organization member. */
export const OrgMember = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: true, superAdminOnly: false });

/** Requires a super-admin JWT. */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: true });

/** Requires any valid JWT (member or super-admin). */
export const Auth = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: false });
