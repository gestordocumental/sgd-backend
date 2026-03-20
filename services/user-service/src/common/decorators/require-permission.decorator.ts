import { SetMetadata } from '@nestjs/common';
import { PermissionModule, PermissionAction } from '../../roles/entities/permission.entity';

export const PERMISSION_KEY = 'required_permission';

export const RequirePermission = (module: PermissionModule, action: PermissionAction) =>
  SetMetadata(PERMISSION_KEY, { module, action });
