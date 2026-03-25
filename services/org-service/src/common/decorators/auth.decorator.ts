import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'org_auth';

export interface AuthMeta {
  /** Solo super admins pueden acceder */
  superAdminOnly?: boolean;
  /** Super admin O usuario cuyo companyId en el JWT coincide con el :id del param */
  orgMember?: boolean;
}

/**
 * Requiere que el caller sea super admin (isSuperAdmin claim en el JWT).
 */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { superAdminOnly: true });

/**
 * Requiere que el caller sea super admin O que su companyId en el JWT
 * coincida con el parámetro :id de la ruta.
 * También permite llamadas internas con x-internal-token.
 */
export const OrgMemberOrSuperAdmin = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: true });
