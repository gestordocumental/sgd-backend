import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  Unique,
} from 'typeorm';
import { Role } from './role.entity';

export enum PermissionModule {
  DOCUMENTS     = 'DOCUMENTS',
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
