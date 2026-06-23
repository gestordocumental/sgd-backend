import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApprovalActionType } from './enums';
import { WorkflowApprovalStep } from './workflow-approval-step.entity';

export interface ApprovalAttachment {
  storageKey: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number | null;
}

/**
 * Log inmutable de cada acción de aprobación/rechazo.
 * Solo permite INSERT — nunca UPDATE ni DELETE.
 * attemptNumber registra cuántas veces ha pasado el workflow por este step.
 */
@Entity('workflow_approval_actions')
export class WorkflowApprovalAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  @Column({ name: 'step_id', type: 'uuid' })
  @Index()
  stepId!: string;

  /** UUID del aprobador que realizó la acción. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'action',
    type: 'enum',
    enum: ApprovalActionType,
  })
  action!: ApprovalActionType;

  /** Obligatorio cuando action = REJECTED. min 10 chars. */
  @Column({ name: 'observations', type: 'text', nullable: true })
  observations: string | null = null;

  /** Número de intento en este step (incrementa con cada rechazo+reenvío). */
  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber!: number;

  /**
   * Documentos adjuntos subidos por el aprobador junto con la aprobación.
   * Cada entrada apunta a un archivo en MinIO/S3 subido via document-service /workflow-files.
   */
  @Column({ name: 'attachments', type: 'jsonb', default: [] })
  attachments: ApprovalAttachment[] = [];

  /** Solo INSERT — no tiene updated_at para reforzar inmutabilidad. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => WorkflowApprovalStep, (step) => step.actions)
  @JoinColumn({ name: 'step_id' })
  step!: WorkflowApprovalStep;
}
