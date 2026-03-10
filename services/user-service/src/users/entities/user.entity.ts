import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';

// Partial unique index: only active (non-deleted) users must have unique emails.
// A plain @Index({ unique: true }) would prevent re-registering a soft-deleted email.
@Entity('users')
@Index('users_email_active_uniq', ['email'], { unique: true, where: '"deleted_at" IS NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  // Required on update — nullable at creation
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName!: string | null;

  // National ID / document number — optional
  @Column({ name: 'id_number', type: 'varchar', length: 50, nullable: true })
  idNumber!: string | null;

  // Job position / title — required at creation
  @Column({ type: 'varchar', length: 100 })
  position!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Platform-level flag — bypasses all org/role checks
  @Column({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin!: boolean;

  // Can be toggled by the user or forced by super admin
  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled!: boolean;

  @OneToMany(() => UserOrgRole, (uor) => uor.user)
  orgRoles!: UserOrgRole[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Soft delete — null means active, timestamp means logically deleted.
  // TypeORM automatically excludes records with deletedAt != null from all queries.
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
