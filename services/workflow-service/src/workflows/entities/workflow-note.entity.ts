import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Workflow } from './workflow.entity';
import { WorkflowAdminStep } from './workflow-admin-step.entity';

/**
 * Notas y observaciones asociadas al workflow o a un paso administrativo.
 * Solo INSERT — no se modifican ni eliminan para mantener integridad de trazabilidad.
 */
@Entity('workflow_notes')
export class WorkflowNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  /** null si la nota es a nivel de workflow general. */
  @Column({ name: 'cycle_id', type: 'uuid', nullable: true })
  cycleId: string | null = null;

  /** null si la nota no está asociada a un paso admin específico. */
  @Column({ name: 'admin_step_id', type: 'uuid', nullable: true })
  adminStepId: string | null = null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  /** Solo INSERT — no tiene updated_at para reforzar inmutabilidad. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => Workflow, (workflow) => workflow.notes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: Workflow;

  @ManyToOne(() => WorkflowAdminStep, (step) => step.notes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'admin_step_id' })
  adminStep: WorkflowAdminStep | null = null;
}
