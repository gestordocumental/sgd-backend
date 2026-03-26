import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'org_auth';

export interface AuthMeta {
  /** Only super admins can access */
  superAdminOnly?: boolean;
  /** Super admin OR user whose companyId in the JWT matches the :id route param */
  orgMember?: boolean;
}

/**
 * Requires the caller to be a super admin (isSuperAdmin claim in the JWT).
 */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { superAdminOnly: true });

/**
 * Requires the caller to be a super admin OR that their companyId in the JWT
 * matches the :id parameter of the route.
 * Internal calls with x-internal-token are also allowed (non-superAdminOnly only).
 */
export const OrgMemberOrSuperAdmin = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: true });
