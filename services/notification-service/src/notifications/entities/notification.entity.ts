import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type NotificationType =
  | 'WORKFLOW_TASK_ASSIGNED'
  | 'WORKFLOW_APPROVED'
  | 'WORKFLOW_REJECTED'
  | 'ADMIN_CYCLE_TASK'
  | 'ADMIN_CYCLE_COMPLETED'
  | 'WORKFLOW_CLOSED'
  | 'NO_FINAL_USER_ALERT';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** ID del usuario destinatario */
  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ length: 60 })
  type!: NotificationType;

  @Column({ length: 300 })
  title!: string;

  @Column('text')
  message!: string;

  @Column({ name: 'workflow_id', nullable: true, type: 'uuid' })
  workflowId!: string | null;

  @Column({ name: 'workflow_title', nullable: true, length: 500 })
  workflowTitle!: string | null;

  @Column({ default: false })
  read!: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
