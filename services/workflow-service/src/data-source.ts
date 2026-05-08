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

const isDev = process.env.NODE_ENV !== 'production';

const requireEnv = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const dbPortRaw = process.env.DB_PORT ?? '5432';
const dbPort = Number.parseInt(dbPortRaw, 10);
if (!Number.isInteger(dbPort) || dbPort <= 0 || dbPort > 65535) {
  throw new Error(`Invalid DB_PORT: "${dbPortRaw}"`);
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: dbPort,
  username: requireEnv('DB_USERNAME', isDev ? 'workflow_user'     : undefined),
  password: requireEnv('DB_PASSWORD', isDev ? 'workflow_password' : undefined),
  database: requireEnv('DB_NAME',     isDev ? 'workflow_db'       : undefined),
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
  // parseInt8 convierte columnas BIGINT (int8) de pg a JS number en lugar de string.
  // Actualmente solo se usa en file_size_bytes (tamaños de archivo), cuyos valores
  // nunca superarán Number.MAX_SAFE_INTEGER (≈9 PB). Si se agregan columnas BIGINT
  // con valores potencialmente mayores a 2^53-1, usar BigInt o string en su lugar.
  extra: { parseInt8: true },
});
