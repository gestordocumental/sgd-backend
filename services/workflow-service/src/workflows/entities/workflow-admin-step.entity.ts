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
import { AdminStepStatus } from './enums';
import { WorkflowAdminCycle } from './workflow-admin-cycle.entity';
import { WorkflowAdminAttachment } from './workflow-admin-attachment.entity';
import { WorkflowNote } from './workflow-note.entity';

@Entity('workflow_admin_steps')
@Unique(['cycleId', 'stepOrder'])
export class WorkflowAdminStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cycle_id', type: 'uuid' })
  @Index()
  cycleId!: string;

  /** Desnormalizado para facilitar queries directas sin JOIN a cycle. */
  @Column({ name: 'workflow_id', type: 'uuid' })
  @Index()
  workflowId!: string;

  /** UUID del usuario administrativo asignado a este paso. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'step_order', type: 'int' })
  stepOrder!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AdminStepStatus,
    default: AdminStepStatus.WAITING,
  })
  status!: AdminStepStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────────

  @ManyToOne(() => WorkflowAdminCycle, (cycle) => cycle.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle!: WorkflowAdminCycle;

  @OneToMany(() => WorkflowAdminAttachment, (att) => att.step, { cascade: true })
  attachments!: WorkflowAdminAttachment[];

  @OneToMany(() => WorkflowNote, (note) => note.adminStep, { cascade: true })
  notes!: WorkflowNote[];
}
