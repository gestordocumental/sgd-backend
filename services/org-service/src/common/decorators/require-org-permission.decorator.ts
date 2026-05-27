import { SetMetadata } from '@nestjs/common';

export const ORG_PERMISSION_KEY = 'required_org_permission';

export interface OrgPermissionMeta {
  module: string;
  action: string;
}

/**
 * Declares the ORG_STRUCTURE permission required to access this endpoint.
 * Enforced by OrgPermissionsGuard, which forwards the request to user-service
 * for DB-backed permission resolution.
 *
 * Example:
 *   @RequireOrgPermission('ORG_STRUCTURE', 'WRITE')
 */
export const RequireOrgPermission = (module: string, action: string) =>
  SetMetadata<string, OrgPermissionMeta>(ORG_PERMISSION_KEY, { module, action });
