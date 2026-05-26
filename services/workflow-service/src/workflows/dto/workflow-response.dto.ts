import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowApprovalStep } from '../entities/workflow-approval-step.entity';
import { WorkflowApprovalAction, ApprovalAttachment } from '../entities/workflow-approval-action.entity';
import { WorkflowAttachment } from '../entities/workflow-attachment.entity';
import { WorkflowTimeline } from '../entities/workflow-timeline.entity';
import { WorkflowAdminCycle } from '../entities/workflow-admin-cycle.entity';
import {
  WorkflowStatus,
  ApprovalStepStatus,
  ApprovalActionType,
  AttachmentType,
  TimelineEventType,
  AdminCycleStatus,
  AdminStepStatus,
} from '../entities/enums';

// ── Approval Step ────────────────────────────────────────────────────────────

export class ApprovalStepResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() stepOrder!: number;
  @ApiProperty({ enum: ApprovalStepStatus }) status!: ApprovalStepStatus;
  @ApiPropertyOptional() completedAt: Date | null = null;

  static from(step: WorkflowApprovalStep): ApprovalStepResponseDto {
    return {
      id:          step.id,
      workflowId:  step.workflowId,
      userId:      step.userId,
      stepOrder:   step.stepOrder,
      status:      step.status,
      completedAt: step.completedAt,
    };
  }
}

// ── Timeline Event ────────────────────────────────────────────────────────────

export class TimelineEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty({ enum: TimelineEventType }) eventType!: TimelineEventType;
  @ApiProperty() actorId!: string;
  @ApiPropertyOptional() targetUserId: string | null = null;
  @ApiProperty() description!: string;
  @ApiPropertyOptional() metadata: Record<string, unknown> | null = null;
  @ApiProperty() createdAt!: Date;

  static from(event: WorkflowTimeline): TimelineEventResponseDto {
    return {
      id:           event.id,
      workflowId:   event.workflowId,
      eventType:    event.eventType,
      actorId:      event.actorId,
      targetUserId: event.targetUserId,
      description:  event.description,
      metadata:     event.metadata,
      createdAt:    event.createdAt,
    };
  }
}

// ── Admin Cycle ───────────────────────────────────────────────────────────────

export class AdminStepNoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() content!: string;
  @ApiProperty() createdBy!: string;
  @ApiProperty() createdAt!: Date;
}

export class AdminStepAttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() storageKey!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiPropertyOptional() fileSizeBytes: number | null = null;
  @ApiProperty() uploadedBy!: string;
  @ApiProperty() createdAt!: Date;
}

export class AdminStepResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() cycleId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() stepOrder!: number;
  @ApiProperty({ enum: AdminStepStatus }) status!: AdminStepStatus;
  @ApiProperty() isOptional!: boolean;
  @ApiPropertyOptional() insertedByStepId: string | null = null;
  @ApiPropertyOptional() completedAt: Date | null = null;
  @ApiProperty({ type: [AdminStepNoteResponseDto] }) notes!: AdminStepNoteResponseDto[];
  @ApiProperty({ type: [AdminStepAttachmentResponseDto] }) attachments!: AdminStepAttachmentResponseDto[];
}

export class AdminCycleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty() cycleNumber!: number;
  @ApiProperty() initiatedBy!: string;
  @ApiProperty({ enum: AdminCycleStatus }) status!: AdminCycleStatus;
  @ApiPropertyOptional() currentStepOrder: number | null = null;
  @ApiPropertyOptional() completedAt: Date | null = null;
  @ApiProperty({ type: [String] }) allowedOptionalReviewerIds!: string[];
  @ApiProperty({ type: [AdminStepResponseDto] }) steps!: AdminStepResponseDto[];
  @ApiProperty() createdAt!: Date;

  static from(cycle: WorkflowAdminCycle): AdminCycleResponseDto {
    return {
      id:               cycle.id,
      workflowId:       cycle.workflowId,
      cycleNumber:      cycle.cycleNumber,
      initiatedBy:      cycle.initiatedBy,
      status:           cycle.status,
      currentStepOrder: cycle.currentStepOrder,
      completedAt:      cycle.completedAt,
      allowedOptionalReviewerIds: cycle.allowedOptionalReviewerIds ?? [],
      steps: (cycle.steps ?? []).map((s) => ({
        id:                s.id,
        cycleId:           s.cycleId,
        userId:            s.userId,
        stepOrder:         s.stepOrder,
        status:            s.status,
        isOptional:        s.isOptional,
        insertedByStepId:  s.insertedByStepId,
        completedAt:       s.completedAt,
        notes: (s.notes ?? []).map((n) => ({
          id:        n.id,
          content:   n.content,
          createdBy: n.createdBy,
          createdAt: n.createdAt,
        })),
        attachments: (s.attachments ?? []).map((a) => ({
          id:            a.id,
          storageKey:    a.storageKey,
          originalName:  a.originalName,
          mimeType:      a.mimeType,
          fileSizeBytes: a.fileSizeBytes,
          uploadedBy:    a.uploadedBy,
          createdAt:     a.createdAt,
        })),
      })),
      createdAt: cycle.createdAt,
    };
  }
}

// ── Approval Action ───────────────────────────────────────────────────────────

export class ApprovalActionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty() stepId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: ApprovalActionType }) action!: ApprovalActionType;
  @ApiPropertyOptional() observations: string | null = null;
  @ApiProperty() attemptNumber!: number;
  @ApiProperty({ type: 'array' }) attachments!: ApprovalAttachment[];
  @ApiProperty() createdAt!: Date;

  static from(action: WorkflowApprovalAction): ApprovalActionResponseDto {
    return {
      id:           action.id,
      workflowId:   action.workflowId,
      stepId:       action.stepId,
      userId:       action.userId,
      action:       action.action,
      observations: action.observations,
      attemptNumber: action.attemptNumber,
      attachments:  action.attachments ?? [],
      createdAt:    action.createdAt,
    };
  }
}

// ── Attachment ────────────────────────────────────────────────────────────────

export class AttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty() uploadedBy!: string;
  @ApiProperty() storageKey!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiPropertyOptional() fileSizeBytes: number | null = null;
  @ApiProperty({ enum: AttachmentType }) attachmentType!: AttachmentType;
  @ApiProperty() createdAt!: Date;

  static from(att: WorkflowAttachment): AttachmentResponseDto {
    return {
      id:             att.id,
      workflowId:     att.workflowId,
      uploadedBy:     att.uploadedBy,
      storageKey:     att.storageKey,
      originalName:   att.originalName,
      mimeType:       att.mimeType,
      fileSizeBytes:  att.fileSizeBytes,
      attachmentType: att.attachmentType,
      createdAt:      att.createdAt,
    };
  }
}

// ── Workflow (respuesta principal) ────────────────────────────────────────────

export class WorkflowResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orgId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description: string | null = null;
  @ApiProperty() typologyId!: string;
  @ApiProperty() typologyCode!: string;
  @ApiProperty() typologyVersion!: string;
  @ApiProperty() typologyName!: string;
  @ApiPropertyOptional() mainDocumentId: string | null = null;
  @ApiProperty() mainDocumentValidated!: boolean;
  @ApiPropertyOptional() mainDocumentMetadata: Record<string, unknown> | null = null;
  @ApiProperty({ enum: WorkflowStatus }) status!: WorkflowStatus;
  @ApiPropertyOptional() currentApprovalStepOrder: number | null = null;
  @ApiPropertyOptional() currentAssignedUserId: string | null = null;
  @ApiPropertyOptional({ type: [String] }) finalUserIds: string[] | null = null;
  @ApiProperty() createdBy!: string;
  @ApiPropertyOptional() closedBy: string | null = null;
  @ApiPropertyOptional() closedAt: Date | null = null;
  @ApiPropertyOptional() cancelledBy: string | null = null;
  @ApiPropertyOptional() cancelledAt: Date | null = null;
  @ApiProperty({ type: [ApprovalStepResponseDto] }) approvalSteps!: ApprovalStepResponseDto[];
  @ApiProperty({ type: [ApprovalActionResponseDto] }) approvalActions!: ApprovalActionResponseDto[];
  @ApiProperty({ type: [AttachmentResponseDto] }) attachments!: AttachmentResponseDto[];
  @ApiPropertyOptional({ type: AdminCycleResponseDto }) activeAdminCycle: AdminCycleResponseDto | null = null;
  @ApiProperty({ type: [AdminCycleResponseDto] }) adminCycles!: AdminCycleResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(workflow: Workflow, actions: WorkflowApprovalAction[] = [], activeAdminCycle?: WorkflowAdminCycle, allAdminCycles: WorkflowAdminCycle[] = []): WorkflowResponseDto {
    return {
      id:                       workflow.id,
      orgId:                    workflow.orgId,
      title:                    workflow.title,
      description:              workflow.description,
      typologyId:               workflow.typologyId,
      typologyCode:             workflow.typologyCode,
      typologyVersion:          workflow.typologyVersion,
      typologyName:             workflow.typologyName,
      mainDocumentId:           workflow.mainDocumentId,
      mainDocumentValidated:    workflow.mainDocumentValidated,
      mainDocumentMetadata:     workflow.mainDocumentMetadata,
      status:                   workflow.status,
      currentApprovalStepOrder: workflow.currentApprovalStepOrder,
      currentAssignedUserId:    workflow.currentAssignedUserId,
      finalUserIds:             workflow.finalUserIds,
      createdBy:                workflow.createdBy,
      closedBy:                 workflow.closedBy,
      closedAt:                 workflow.closedAt,
      cancelledBy:              workflow.cancelledBy,
      cancelledAt:              workflow.cancelledAt,
      approvalSteps:            (workflow.approvalSteps ?? []).map(ApprovalStepResponseDto.from),
      approvalActions:          actions.map(ApprovalActionResponseDto.from),
      attachments:              (workflow.attachments ?? []).map(AttachmentResponseDto.from),
      activeAdminCycle:         activeAdminCycle ? AdminCycleResponseDto.from(activeAdminCycle) : null,
      adminCycles:              allAdminCycles.map(AdminCycleResponseDto.from),
      createdAt:                workflow.createdAt,
      updatedAt:                workflow.updatedAt,
    };
  }
}

// ── Respuesta paginada ─────────────────────────────────────────────────────────

export class PaginatedWorkflowsDto {
  @ApiProperty({ type: [WorkflowResponseDto] }) data!: WorkflowResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}
