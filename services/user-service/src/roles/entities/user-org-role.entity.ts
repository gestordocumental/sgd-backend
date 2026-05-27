import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Role } from './role.entity';

@Entity('user_org_roles')
@Unique(['userId', 'orgId']) // one membership per org per user
export class UserOrgRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Cross-DB reference to org_db — no real FK (Database per Service)
  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  // Nullable: user belongs to the org but may have no role assigned yet
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId!: string | null;

  // Audit trail: who assigned this role
  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy!: string | null;

  // Set when the user is explicitly removed from the org (DELETE /users/:id/orgs/:orgId).
  // Null means the user is an active member (with or without a role assigned).
  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true, default: null })
  removedAt!: Date | null;

  @ManyToOne(() => User, (user) => user.orgRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Role, (role) => role.userOrgRoles, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'role_id' })
  role!: Role | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
