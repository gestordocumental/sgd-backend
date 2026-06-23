import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { AdminCycleStatus } from './enums';
import { Workflow } from './workflow.entity';
import { WorkflowAdminStep } from './workflow-admin-step.entity';

@Entity('workflow_admin_cycles')
@Unique(['workflowId', 'cycleNumber'])
export class WorkflowAdminCycle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  /** Número secuencial del ciclo (1, 2, 3...). Incrementa con cada nuevo ciclo. */
  @Column({ name: 'cycle_number', type: 'int', default: 1 })
  cycleNumber!: number;

  /** UUID del usuario final que inició este ciclo. */
  @Column({ name: 'initiated_by', type: 'uuid' })
  initiatedBy!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AdminCycleStatus,
    default: AdminCycleStatus.IN_PROGRESS,
  })
  status!: AdminCycleStatus;

  /** Orden del paso administrativo actualmente activo. */
  @Column({ name: 'current_step_order', type: 'int', nullable: true })
  currentStepOrder: number | null = null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null = null;

  /**
   * UUIDs de usuarios que pueden ser invocados como revisores opcionales en cualquier
   * paso de este ciclo. Definido al crear el ciclo por el usuario final iniciador.
   */
  @Column({ name: 'allowed_optional_reviewer_ids', type: 'uuid', array: true, default: [] })
  allowedOptionalReviewerIds!: string[];

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => Workflow, (workflow) => workflow.adminCycles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: Workflow;

  @OneToMany(() => WorkflowAdminStep, (step) => step.cycle, { cascade: true })
  steps!: WorkflowAdminStep[];
}
