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
import { ApprovalStepStatus } from './enums';
import { Workflow } from './workflow.entity';
import { WorkflowApprovalAction } from './workflow-approval-action.entity';

@Entity('workflow_approval_steps')
@Unique(['workflowId', 'stepOrder'])
export class WorkflowApprovalStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  /** UUID del usuario aprobador (referencia a user-service). */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Posición en la cadena de aprobación (1, 2, 3...). */
  @Column({ name: 'step_order', type: 'int' })
  stepOrder!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ApprovalStepStatus,
    default: ApprovalStepStatus.WAITING,
  })
  status!: ApprovalStepStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => Workflow, (workflow) => workflow.approvalSteps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow!: Workflow;

  @OneToMany(() => WorkflowApprovalAction, (action) => action.step, { cascade: true })
  actions!: WorkflowApprovalAction[];
}
