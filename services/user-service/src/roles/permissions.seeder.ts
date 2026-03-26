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
  // DOCUMENTS
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.READ,     description: 'View documents' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.WRITE,    description: 'Create and edit documents' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.DELETE,   description: 'Delete documents' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.APPROVE,  description: 'Approve documents' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.UPLOAD,   description: 'Upload files' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.DOWNLOAD, description: 'Download files' },

  // WORKFLOWS
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.READ,    description: 'View workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.WRITE,   description: 'Create and edit workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.DELETE,  description: 'Delete workflows' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE, description: 'Approve workflow steps' },

  // USERS
  { module: PermissionModule.USERS, action: PermissionAction.READ,   description: 'View users' },
  { module: PermissionModule.USERS, action: PermissionAction.WRITE,  description: 'Create and edit users' },
  { module: PermissionModule.USERS, action: PermissionAction.DELETE, description: 'Delete users' },
  { module: PermissionModule.USERS, action: PermissionAction.MANAGE, description: 'Full user management' },

  // ORGS
  { module: PermissionModule.ORGS, action: PermissionAction.READ,   description: 'View organization information' },
  { module: PermissionModule.ORGS, action: PermissionAction.WRITE,  description: 'Edit organization information' },
  { module: PermissionModule.ORGS, action: PermissionAction.MANAGE, description: 'Full organization management' },

  // AUDIT
  { module: PermissionModule.AUDIT, action: PermissionAction.READ, description: 'View audit records' },

  // PLATFORM — exclusive to SUPER_ADMIN
  { module: PermissionModule.PLATFORM, action: PermissionAction.MANAGE, description: 'Full platform access (super admin only)' },
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
      .orIgnore() // ON CONFLICT (module, action) DO NOTHING
      .execute();

    this.logger.log(`Permissions catalog synced (${PERMISSIONS_CATALOG.length} entries)`);
  }
}
