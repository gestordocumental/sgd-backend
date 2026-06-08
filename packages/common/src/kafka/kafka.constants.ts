/** Injection token for the KafkaJs Kafka instance. */
export const KAFKA_CLIENT = 'KAFKA_CLIENT';

export const TOPICS = {
  AUDIT_LOG: 'audit.log',
  NOTIFICATION_SEND: 'notification.send',
  USER_INVITED: 'user.invited',
  PASSWORD_RESET: 'auth.password-reset',
  USER_ORG_REMOVED: 'user.org-removed',
  USER_SUPER_ADMIN_REVOKED: 'user.super-admin-revoked',
  USER_PERMISSIONS_CHANGED: 'user.permissions-changed',
  TYPOLOGY_FILE_UPLOADED: 'typology.file.uploaded',
  TYPOLOGY_METADATA_EXTRACTED: 'typology.metadata.extracted',
  TYPOLOGY_METADATA_EXTRACTION_FAILED: 'typology.metadata.extraction.failed',
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_APPROVAL_STARTED: 'workflow.approval.started',
  WORKFLOW_APPROVAL_REJECTED: 'workflow.approval.rejected',
  WORKFLOW_APPROVAL_APPROVED: 'workflow.approval.approved',
  WORKFLOW_APPROVAL_COMPLETED: 'workflow.approval.completed',
  WORKFLOW_RETURNED_TO_CREATOR: 'workflow.returned.to.creator',
  WORKFLOW_RESUBMITTED: 'workflow.resubmitted',
  WORKFLOW_AVAILABLE_FOR_FINAL_USERS: 'workflow.available.for.final.users',
  WORKFLOW_ADMIN_CYCLE_STARTED: 'workflow.admin.cycle.started',
  WORKFLOW_ADMIN_CYCLE_STEP_COMPLETED: 'workflow.admin.cycle.step.completed',
  WORKFLOW_ADMIN_CYCLE_COMPLETED: 'workflow.admin.cycle.completed',
  WORKFLOW_CLOSED: 'workflow.closed',
  WORKFLOW_CANCELLED: 'workflow.cancelled',
} as const;

export type TopicKey = keyof typeof TOPICS;
