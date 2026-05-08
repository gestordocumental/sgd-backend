import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TimelineEventType } from './enums';
import { Workflow } from './workflow.entity';

/**
 * Línea de tiempo local del workflow.
 *
 * Propósito: servir el endpoint GET /workflows/:id/timeline con datos locales y rápidos.
 * No reemplaza al audit-service — los mismos eventos se publican vía Kafka → audit.log.
 *
 * Solo INSERT — nunca UPDATE ni DELETE.
 */
@Entity('workflow_timeline')
export class WorkflowTimeline {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: TimelineEventType,
  })
  eventType!: TimelineEventType;

  /** UUID del usuario que realizó la acción. */
  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  /** UUID del usuario al que va dirigida la acción (siguiente aprobador, etc.). null si no aplica. */
  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId: string | null = null;

  /** Descripción legible del evento para mostrar en UI. */
  @Column({ name: 'description', type: 'text' })
  description!: string;

  /** Payload flexible: observations, attachments, notes, stepOrder, cycleNumber, etc. */
  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  /** Solo INSERT — no tiene updated_at. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => Workflow, (workflow) => workflow.timeline, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: Workflow;
}
