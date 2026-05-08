import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WorkflowAdminStep } from './workflow-admin-step.entity';

/**
 * Adjuntos subidos por usuarios administrativos durante un paso de ciclo admin.
 * Separados de WorkflowAttachment para mantener trazabilidad por step.
 */
@Entity('workflow_admin_attachments')
export class WorkflowAdminAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  @Column({ name: 'cycle_id', type: 'uuid' })
  @Index()
  cycleId!: string;

  @Column({ name: 'step_id', type: 'uuid' })
  @Index()
  stepId!: string;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @Column({ name: 'document_id', type: 'varchar', length: 255 })
  documentId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'original_name', type: 'varchar', length: 500 })
  originalName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => WorkflowAdminStep, (step) => step.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'step_id' })
  step!: WorkflowAdminStep;
}
