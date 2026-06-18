import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'auth_meta';

export interface AuthMeta {
  orgMember: boolean;
  superAdminOnly: boolean;
}

/** Marks a route as requiring a valid JWT belonging to the :orgId org member. */
export const OrgMember = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: true, superAdminOnly: false });

/** Marks a route as requiring super-admin JWT. */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: true });

/** Marks a route as requiring any valid JWT (org member OR super admin). */
export const Auth = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: false });
