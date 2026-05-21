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
import { WorkflowStatus } from './enums';
import { WorkflowApprovalStep } from './workflow-approval-step.entity';
import { WorkflowAttachment } from './workflow-attachment.entity';
import { WorkflowAdminCycle } from './workflow-admin-cycle.entity';
import { WorkflowNote } from './workflow-note.entity';
import { WorkflowTimeline } from './workflow-timeline.entity';

@Entity('workflows')
@Index(['orgId', 'status'])
@Index(['orgId', 'createdAt'])
@Index(['createdBy'])
@Index(['currentAssignedUserId'])
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Organización a la que pertenece el workflow. Scoped por companyId del JWT. */
  @Column({ name: 'org_id', type: 'uuid' })
  @Index()
  orgId!: string;

  @Column({ name: 'title', type: 'varchar', length: 500 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null = null;

  // ── Tipología (referencia a document-service, MongoDB ObjectId como string) ──

  /** MongoDB ObjectId de la tipología en document-service. */
  @Column({ name: 'typology_id', type: 'varchar', length: 24 })
  typologyId!: string;

  /** Denormalizado para no consultar document-service en cada operación. */
  @Column({ name: 'typology_code', type: 'varchar', length: 100 })
  typologyCode!: string;

  @Column({ name: 'typology_version', type: 'varchar', length: 50 })
  typologyVersion!: string;

  @Column({ name: 'typology_name', type: 'varchar', length: 500 })
  typologyName!: string;

  // ── Documento principal ──────────────────────────────────────────────────────

  /** ID del documento principal en document-service. */
  @Column({ name: 'main_document_id', type: 'varchar', length: 255, nullable: true })
  mainDocumentId: string | null = null;

  /** true cuando document-service confirmó que título/código/versión coinciden con la tipología. */
  @Column({ name: 'main_document_validated', type: 'boolean', default: false })
  mainDocumentValidated!: boolean;

  /** Snapshot del resultado de validación: { title, code, version, storageKey, discrepancies }. */
  @Column({ name: 'main_document_metadata', type: 'jsonb', nullable: true })
  mainDocumentMetadata: Record<string, unknown> | null = null;

  // ── Estado y asignación ──────────────────────────────────────────────────────

  @Column({
    name: 'status',
    type: 'enum',
    enum: WorkflowStatus,
    default: WorkflowStatus.DRAFT,
  })
  status!: WorkflowStatus;

  /** Orden del paso de aprobación actualmente en curso (1-based). */
  @Column({ name: 'current_approval_step_order', type: 'int', nullable: true })
  currentApprovalStepOrder: number | null = null;

  /** FK al WorkflowApprovalStep que rechazó para saber desde dónde reenviar. */
  @Column({ name: 'rejected_at_step_id', type: 'uuid', nullable: true })
  rejectedAtStepId: string | null = null;

  /** UUID del usuario que debe actuar en este momento. */
  @Column({ name: 'current_assigned_user_id', type: 'uuid', nullable: true })
  currentAssignedUserId: string | null = null;

  // ── Usuarios finales (snapshot al momento de aprobación) ─────────────────────

  /**
   * IDs de usuarios finales capturados en el momento en que el workflow fue aprobado.
   * Se determinan a partir de cargo/área/departamento de la tipología via user-service.
   * Almacenado como array de UUIDs en PostgreSQL.
   */
  @Column({ name: 'final_user_ids', type: 'uuid', array: true, nullable: true })
  finalUserIds: string[] | null = null;

  /** FK al ciclo administrativo activo. null si no hay ciclo en curso. */
  @Column({ name: 'active_admin_cycle_id', type: 'uuid', nullable: true })
  activeAdminCycleId: string | null = null;

  // ── Autoría ──────────────────────────────────────────────────────────────────

  @Column({ name: 'created_by', type: 'uuid' })
  @Index()
  createdBy!: string;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy: string | null = null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null = null;

  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledBy: string | null = null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null = null;

  // ── Metadata flexible ─────────────────────────────────────────────────────────

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  // ── Timestamps ────────────────────────────────────────────────────────────────

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null = null;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @OneToMany(() => WorkflowApprovalStep, (step) => step.workflow, { cascade: true })
  approvalSteps!: WorkflowApprovalStep[];

  @OneToMany(() => WorkflowAttachment, (att) => att.workflow, { cascade: true })
  attachments!: WorkflowAttachment[];

  @OneToMany(() => WorkflowAdminCycle, (cycle) => cycle.workflow, { cascade: true })
  adminCycles!: WorkflowAdminCycle[];

  @OneToMany(() => WorkflowNote, (note) => note.workflow, { cascade: true })
  notes!: WorkflowNote[];

  @OneToMany(() => WorkflowTimeline, (event) => event.workflow, { cascade: true })
  timeline!: WorkflowTimeline[];
}
