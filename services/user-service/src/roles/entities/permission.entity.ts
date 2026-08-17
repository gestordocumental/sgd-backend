import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  Unique,
} from 'typeorm';
import { Role } from './role.entity';

// DOCUMENTS intentionally not modeled here anymore — see permissions.seeder.ts
// for why. 'DOCUMENTS' may still be a valid label on the underlying Postgres
// enum type (dropping a value from a native enum type requires rebuilding it,
// same as 1776600000000-RemoveSuperAdminRole.ts did for 'PLATFORM' — not done
// here since zero rows use it and nothing in this codebase can write it
// anymore) — harmless, just an unused value the DB type still permits.
export enum PermissionModule {
  WORKFLOWS     = 'WORKFLOWS',
  USERS         = 'USERS',
  ROLES         = 'ROLES',
  ORG_STRUCTURE = 'ORG_STRUCTURE',
  AUDIT         = 'AUDIT',
}

export enum PermissionAction {
  READ     = 'READ',
  WRITE    = 'WRITE',
  DELETE   = 'DELETE',
  APPROVE  = 'APPROVE',
  UPLOAD   = 'UPLOAD',
  DOWNLOAD = 'DOWNLOAD',
  MANAGE   = 'MANAGE', // full control
}

@Entity('permissions')
@Unique(['module', 'action'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: PermissionModule })
  module!: PermissionModule;

  @Column({ type: 'enum', enum: PermissionAction })
  action!: PermissionAction;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @ManyToMany(() => Role, (role) => role.permissions)
  roles!: Role[];
}
