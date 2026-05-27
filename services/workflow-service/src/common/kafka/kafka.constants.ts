export const KAFKA_CLIENT = 'KAFKA_CLIENT';

export const TOPICS = {
  // Eventos que publica workflow-service
  WORKFLOW_CREATED:                   'workflow.created',
  WORKFLOW_APPROVAL_STARTED:          'workflow.approval.started',
  WORKFLOW_APPROVAL_REJECTED:         'workflow.approval.rejected',
  WORKFLOW_APPROVAL_APPROVED:         'workflow.approval.approved',
  WORKFLOW_APPROVAL_COMPLETED:        'workflow.approval.completed',
  WORKFLOW_RETURNED_TO_CREATOR:       'workflow.returned.to.creator',
  WORKFLOW_RESUBMITTED:               'workflow.resubmitted',
  WORKFLOW_AVAILABLE_FOR_FINAL_USERS: 'workflow.available.for.final.users',
  WORKFLOW_ADMIN_CYCLE_STARTED:       'workflow.admin.cycle.started',
  WORKFLOW_ADMIN_CYCLE_STEP_COMPLETED:'workflow.admin.cycle.step.completed',
  WORKFLOW_ADMIN_CYCLE_COMPLETED:     'workflow.admin.cycle.completed',
  WORKFLOW_CLOSED:                    'workflow.closed',
  WORKFLOW_CANCELLED:                 'workflow.cancelled',

  // Tópicos consumidos por otros servicios
  NOTIFICATION_SEND: 'notification.send',
  AUDIT_LOG:         'audit.log',
} as const;

export type TopicKey = keyof typeof TOPICS;
