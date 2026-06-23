import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AttachmentType } from './enums';
import { Workflow } from './workflow.entity';

/**
 * Adjuntos del workflow base (documento principal + documentos de soporte).
 * Los adjuntos de ciclos administrativos están en WorkflowAdminAttachment.
 */
@Entity('workflow_attachments')
export class WorkflowAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  /** Usuario que subió el adjunto. */
  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  /** ID del documento en document-service (puede ser un ObjectId de MongoDB o un UUID). */
  @Column({ name: 'document_id', type: 'varchar', length: 255 })
  documentId!: string;

  /** Clave S3/MinIO para acceder directamente al archivo si se necesita. */
  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'original_name', type: 'varchar', length: 500 })
  originalName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number | null = null;

  @Column({
    name: 'attachment_type',
    type: 'enum',
    enum: AttachmentType,
    default: AttachmentType.SUPPORTING,
  })
  attachmentType!: AttachmentType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => Workflow, (workflow) => workflow.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: Workflow;
}
