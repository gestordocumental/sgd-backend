import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Workflow } from './workflows/entities/workflow.entity';
import { WorkflowApprovalStep } from './workflows/entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './workflows/entities/workflow-approval-action.entity';
import { WorkflowAttachment } from './workflows/entities/workflow-attachment.entity';
import { WorkflowAdminCycle } from './workflows/entities/workflow-admin-cycle.entity';
import { WorkflowAdminStep } from './workflows/entities/workflow-admin-step.entity';
import { WorkflowAdminAttachment } from './workflows/entities/workflow-admin-attachment.entity';
import { WorkflowNote } from './workflows/entities/workflow-note.entity';
import { WorkflowTimeline } from './workflows/entities/workflow-timeline.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'workflow_user',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'workflow_db',
  entities: [
    Workflow,
    WorkflowApprovalStep,
    WorkflowApprovalAction,
    WorkflowAttachment,
    WorkflowAdminCycle,
    WorkflowAdminStep,
    WorkflowAdminAttachment,
    WorkflowNote,
    WorkflowTimeline,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // 'each' da a cada migración su propia transacción
  migrationsTransactionMode: 'each',
  synchronize: false,
});
