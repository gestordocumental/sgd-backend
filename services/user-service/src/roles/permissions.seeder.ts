import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, PermissionModule, PermissionAction } from './entities/permission.entity';

/**
 * Defines which module+action combinations are valid permissions.
 * This is the single source of truth — adding a new permission means
 * adding it here and to the enum. No migration needed.
 */
const PERMISSIONS_CATALOG: {
  module: PermissionModule;
  action: PermissionAction;
  description: string;
}[] = [
  // DOCUMENTS intentionally omitted — document-service has no RequirePermission
  // guard on any endpoint (only JwtGuard/OrgMember), so this module was pure
  // dead weight in the roles editor: assignable, but never actually checked
  // anywhere. 1776400000000-CleanupUnusedPermissions.ts already deleted the
  // existing rows once, but this seeder re-inserted them on every subsequent
  // boot (onApplicationBootstrap runs an upsert of the whole catalog below,
  // unconditionally) — see 1776900000000-RemoveDocumentsPermissionsForGood.ts
  // for the migration that removes them again, this time for good now that
  // they're no longer in this catalog to be re-seeded.

  // WORKFLOWS
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.READ,    description: 'View workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.WRITE,   description: 'Create and edit workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.DELETE,  description: 'Delete workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE, description: 'Approve workflow steps' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.MANAGE,  description: 'View all organization workflows' },

  // USERS
  { module: PermissionModule.USERS, action: PermissionAction.READ,   description: 'View users' },
  { module: PermissionModule.USERS, action: PermissionAction.WRITE,  description: 'Create and edit users' },
  { module: PermissionModule.USERS, action: PermissionAction.DELETE, description: 'Delete users' },
  { module: PermissionModule.USERS, action: PermissionAction.MANAGE, description: 'Full user management' },

  // ROLES
  { module: PermissionModule.ROLES, action: PermissionAction.READ,  description: 'View and manage roles' },
  { module: PermissionModule.ROLES, action: PermissionAction.WRITE, description: 'Create and edit roles' },

  // ORG_STRUCTURE
  { module: PermissionModule.ORG_STRUCTURE, action: PermissionAction.READ,   description: 'View organizational structure' },
  { module: PermissionModule.ORG_STRUCTURE, action: PermissionAction.WRITE,  description: 'Edit organizational structure' },
  { module: PermissionModule.ORG_STRUCTURE, action: PermissionAction.DELETE, description: 'Delete organizational structure elements' },

  // AUDIT
  { module: PermissionModule.AUDIT, action: PermissionAction.READ, description: 'View audit records' },

];

@Injectable()
export class PermissionsSeeder implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
  ) {}

  private readonly logger = new Logger(PermissionsSeeder.name);

  async onApplicationBootstrap(): Promise<void> {
    await this.permissionsRepository
      .createQueryBuilder()
      .insert()
      .into(Permission)
      .values(PERMISSIONS_CATALOG)
      .orUpdate(['description'], ['module', 'action'])
      .execute();

    this.logger.log(`Permissions catalog synced (${PERMISSIONS_CATALOG.length} entries)`);
  }
}
