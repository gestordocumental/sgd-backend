import { SetMetadata } from '@nestjs/common';

export const AUTH_KEY = 'auth_meta';

export interface AuthMeta {
  orgMember: boolean;
  superAdminOnly: boolean;
}

/** Requiere JWT de super admin. */
export const SuperAdminOnly = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: true });

/** Requiere cualquier JWT válido. */
export const Auth = () =>
  SetMetadata<string, AuthMeta>(AUTH_KEY, { orgMember: false, superAdminOnly: false });
