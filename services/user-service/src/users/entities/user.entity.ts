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

export enum RegistrationStatus {
  /** Invited — profile may be partially filled, credentials not yet created. */
  PENDING_CREDENTIALS = 'pending_credentials',
  /** Registration complete — credentials exist, user can log in. */
  ACTIVE = 'active',
}

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

  // Job position / title — nullable, replaced by departamento/area/cargo structure
  @Column({ type: 'varchar', length: 100, nullable: true })
  position!: string | null;

  // Org-structure references (plain UUIDs — no FK, cross-service)
  @Column({ name: 'departamento_id', type: 'uuid', nullable: true })
  departamentoId!: string | null;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId!: string | null;

  @Column({ name: 'cargo_id', type: 'uuid', nullable: true })
  cargoId!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({
    name: 'registration_status',
    type: 'enum',
    enum: RegistrationStatus,
    default: RegistrationStatus.PENDING_CREDENTIALS,
  })
  registrationStatus!: RegistrationStatus;

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
