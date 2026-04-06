import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  OneToMany,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { Permission } from './permission.entity';
import { UserOrgRole } from './user-org-role.entity';

export enum RoleScope {
  SYSTEM = 'SYSTEM', // cross-tenant — only for super admin
  ORG    = 'ORG',    // scoped to a specific organization
}

// Predefined system role names — custom org roles use free-form strings
export enum SystemRoleName {
  ADMIN       = 'ADMIN',
  MANAGER     = 'MANAGER',
  EDITOR      = 'EDITOR',
  VIEWER      = 'VIEWER',
}

@Entity('roles')
@Unique(['name', 'orgId']) // same role name can exist in different orgs
// Partial index: enforces name uniqueness for system roles (org_id IS NULL).
// The @Unique above does NOT cover this case because NULL != NULL in SQL.
@Index('roles_name_system_uniq', ['name'], { unique: true, where: '"org_id" IS NULL' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // System roles use SystemRoleName values; custom roles use free-form names
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'enum', enum: RoleScope })
  scope!: RoleScope;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // System roles cannot be modified or deleted
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  // null = system role (available to all orgs)
  // uuid = custom role belonging to a specific org
  @Index()
  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId!: string | null;

  @ManyToMany(() => Permission, (permission) => permission.roles, {
    eager: false,
  })
  @JoinTable({
    name: 'role_permissions',
    joinColumn:        { name: 'role_id',       referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions!: Permission[];

  @OneToMany(() => UserOrgRole, (uor) => uor.role)
  userOrgRoles!: UserOrgRole[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
