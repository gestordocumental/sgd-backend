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
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.READ,     description: 'Ver documentos' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.WRITE,    description: 'Crear y editar documentos' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.DELETE,   description: 'Eliminar documentos' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.APPROVE,  description: 'Aprobar documentos' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.UPLOAD,   description: 'Subir archivos' },
  { module: PermissionModule.DOCUMENTS, action: PermissionAction.DOWNLOAD, description: 'Descargar archivos' },

  // WORKFLOWS
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.READ,    description: 'Ver flujos de trabajo' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.WRITE,   description: 'Crear y editar flujos' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.DELETE,  description: 'Eliminar flujos' },
  { module: PermissionModule.WORKFLOWS, action: PermissionAction.APPROVE, description: 'Aprobar pasos de flujo' },

  // USERS
  { module: PermissionModule.USERS, action: PermissionAction.READ,   description: 'Ver usuarios' },
  { module: PermissionModule.USERS, action: PermissionAction.WRITE,  description: 'Crear y editar usuarios' },
  { module: PermissionModule.USERS, action: PermissionAction.DELETE, description: 'Eliminar usuarios' },
  { module: PermissionModule.USERS, action: PermissionAction.MANAGE, description: 'Gestión completa de usuarios' },

  // ORGS
  { module: PermissionModule.ORGS, action: PermissionAction.READ,   description: 'Ver información de la organización' },
  { module: PermissionModule.ORGS, action: PermissionAction.WRITE,  description: 'Editar información de la organización' },
  { module: PermissionModule.ORGS, action: PermissionAction.MANAGE, description: 'Gestión completa de la organización' },

  // AUDIT
  { module: PermissionModule.AUDIT, action: PermissionAction.READ, description: 'Ver registros de auditoría' },

  // PLATFORM — exclusive to SUPER_ADMIN
  { module: PermissionModule.PLATFORM, action: PermissionAction.MANAGE, description: 'Acceso total a la plataforma (solo super admin)' },
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
