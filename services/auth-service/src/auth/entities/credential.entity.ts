import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from "typeorm";

export enum CredentialStatus {
  ACTIVE = "active", // Registration is complete
  DISABLED = "disabled", // Blocked by admin/security
}

// Partial unique index: enforces email uniqueness only among non-deleted rows,
// allowing future soft-deletion of credentials while permitting email reuse.
@Index("IDX_credentials_email_active", ["email"], { unique: true, where: '"deleted_at" IS NULL' })
@Entity("credentials")
export class Credential {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  email!: string;

  // Cross-service reference to user-service's User.id.
  // No DB FK by design: auth-service and user-service use separate databases (microservice boundary).
  // Integrity is maintained at the application layer:
  //   - Only user-service may write this field via POST /credentials/provision (x-internal-token).
  //   - No other code path creates a Credential record, so no other source of userId exists.
  //   - ProvisionCredentialDto validates the value as a UUID before it reaches the service.
  @Index({ unique: true })
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  // It is filled in when the user completes the invitation.
  @Column({ name: "password_hash", type: "varchar", nullable: true })
  passwordHash!: string | null;

  // Credential status according to the invitation cycle
  @Column({
    type: "enum",
    enum: CredentialStatus,
    default: CredentialStatus.ACTIVE,
  })
  status!: CredentialStatus;

  @Column({ name: "locked_until", type: "timestamptz", nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}
