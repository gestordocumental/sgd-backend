import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum CredentialStatus {
  ACTIVE = "active", // Registration is complete
  DISABLED = "disabled", // Blocked by admin/security
}

@Entity("credentials")
@Index(["email"], { unique: true }) // global unique email (one identity per email)
export class Credential {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  email!: string;

  // Logical relationship with the User Service
  @Index({ unique: true })
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  // It is filled in when the user completes the invitation.
  @Column({ name: "password_hash" })
  passwordHash!: string;

  // Credential status according to the invitation cycle
  @Column({
    type: "enum",
    enum: CredentialStatus,
    default: CredentialStatus.ACTIVE,
  })
  status!: CredentialStatus;

  // Refresh current token (optional) for rotation/revocation
  @Column({ name: "refresh_token_hash", nullable: true })
  refreshTokenHash!: string | null;

  @Column({ name: "locked_until", type: "timestamptz", nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
