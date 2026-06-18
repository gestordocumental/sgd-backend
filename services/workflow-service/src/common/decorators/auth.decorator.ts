import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'auth_meta';

export interface AuthMeta {
  orgMember: boolean;
  superAdminOnly: boolean;
}

/** Requiere JWT válido de miembro de la organización (:orgId en params debe coincidir con companyId del token). */
export const OrgMember = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: true, superAdminOnly: false });

/** Requiere JWT de super admin. */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: true });

/** Requiere cualquier JWT válido (miembro o super admin). */
export const Auth = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: false });
