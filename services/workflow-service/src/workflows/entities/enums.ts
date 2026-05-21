/**
 * Enums del dominio workflow-service.
 * Todos los valores son strings para facilitar legibilidad en la base de datos.
 */

export enum WorkflowStatus {
  DRAFT                      = 'DRAFT',
  PENDING_APPROVAL           = 'PENDING_APPROVAL',
  RETURNED_TO_CREATOR        = 'RETURNED_TO_CREATOR', // legacy — kept for existing DB rows
  REJECTED                   = 'REJECTED',             // terminal: flujo rechazado, no se puede reabrir
  PENDING_REVIEW_CYCLE       = 'PENDING_REVIEW_CYCLE',
  AVAILABLE_FOR_FINAL_USERS  = 'AVAILABLE_FOR_FINAL_USERS',
  ADMIN_CYCLE_IN_PROGRESS    = 'ADMIN_CYCLE_IN_PROGRESS',
  CLOSED                     = 'CLOSED',
  CANCELLED                  = 'CANCELLED',
}

export enum ApprovalStepStatus {
  WAITING  = 'WAITING',   // Aún no es su turno
  PENDING  = 'PENDING',   // Es su turno, debe actuar
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ApprovalActionType {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum AdminCycleStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED   = 'COMPLETED',
}

export enum AdminStepStatus {
  WAITING   = 'WAITING',
  PENDING   = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export enum AttachmentType {
  MAIN_DOCUMENT = 'MAIN_DOCUMENT',
  SUPPORTING    = 'SUPPORTING',
}

export enum TimelineEventType {
  WORKFLOW_CREATED            = 'WORKFLOW_CREATED',
  WORKFLOW_UPDATED            = 'WORKFLOW_UPDATED',
  APPROVAL_STARTED            = 'APPROVAL_STARTED',
  STEP_APPROVED               = 'STEP_APPROVED',
  STEP_REJECTED               = 'STEP_REJECTED',
  WORKFLOW_RETURNED_TO_CREATOR= 'WORKFLOW_RETURNED_TO_CREATOR',
  WORKFLOW_RESUBMITTED        = 'WORKFLOW_RESUBMITTED',
  WORKFLOW_APPROVED           = 'WORKFLOW_APPROVED',
  ATTACHMENT_ADDED            = 'ATTACHMENT_ADDED',
  NOTE_ADDED                  = 'NOTE_ADDED',
  ADMIN_CYCLE_STARTED         = 'ADMIN_CYCLE_STARTED',
  ADMIN_STEP_COMPLETED        = 'ADMIN_STEP_COMPLETED',
  ADMIN_CYCLE_COMPLETED       = 'ADMIN_CYCLE_COMPLETED',
  WORKFLOW_CLOSED             = 'WORKFLOW_CLOSED',
  WORKFLOW_CANCELLED          = 'WORKFLOW_CANCELLED',
}
