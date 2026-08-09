import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowApprovalStep } from '../entities/workflow-approval-step.entity';
import { WorkflowApprovalAction, ApprovalAttachment } from '../entities/workflow-approval-action.entity';
import { WorkflowAttachment } from '../entities/workflow-attachment.entity';
import { WorkflowNote } from '../entities/workflow-note.entity';
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
  // Resolved server-side (see WorkflowsService.getTimeline) so the timeline shows
  // who did what regardless of whether the viewer's role can read the Users module —
  // null only if user-service couldn't be reached or the actor no longer exists.
  @ApiPropertyOptional() actorName: string | null = null;
  @ApiPropertyOptional() targetUserId: string | null = null;
  @ApiProperty() description!: string;
  @ApiPropertyOptional() metadata: Record<string, unknown> | null = null;
  @ApiProperty() createdAt!: Date;

  static from(event: WorkflowTimeline, actorName: string | null = null): TimelineEventResponseDto {
    return {
      id:           event.id,
      workflowId:   event.workflowId,
      eventType:    event.eventType,
      actorId:      event.actorId,
      actorName,
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
  // Solo para attachmentType MANAGEMENT — la nota (ver WorkflowNoteResponseDto)
  // que este adjunto acompaña, si hay una.
  @ApiPropertyOptional() noteId: string | null = null;
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
      noteId:         att.noteId ?? null,
      createdAt:      att.createdAt,
    };
  }
}

// ── Workflow-level note ("Gestionar") ─────────────────────────────────────────

export class WorkflowNoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() content!: string;
  @ApiProperty() createdBy!: string;
  @ApiProperty() createdAt!: Date;

  static from(note: WorkflowNote): WorkflowNoteResponseDto {
    return {
      id:        note.id,
      content:   note.content,
      createdBy: note.createdBy,
      createdAt: note.createdAt,
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
  // Snapshot denormalizado — ver comentario en la entidad Workflow. El
  // chequeo autoritativo siempre es en vivo contra document-service
  // (approve()/createCycle()); este campo es solo para mostrar/ocultar el
  // botón. En respuestas de UN SOLO workflow (nunca listas/paginadas) se
  // refresca en vivo en WorkflowsService.findOneOrFail cuando el estado lo
  // amerita, así que ahí siempre coincide con la disponibilidad real.
  @ApiProperty() reviewCycleEnabled!: boolean;
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
  // Comentarios agregados vía "Gestionar" (o al cerrar) — notas de workflow sin
  // cycleId/adminStepId; excluye las de un ciclo administrativo, que van dentro
  // de activeAdminCycle/adminCycles[].steps[].notes.
  @ApiProperty({ type: [WorkflowNoteResponseDto] }) notes!: WorkflowNoteResponseDto[];
  @ApiPropertyOptional({ type: AdminCycleResponseDto }) activeAdminCycle: AdminCycleResponseDto | null = null;
  @ApiProperty({ type: [AdminCycleResponseDto] }) adminCycles!: AdminCycleResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  // Resolved server-side (see WorkflowsService.findOneOrFail) so anyone who can
  // view the workflow sees who's involved in it — approvers, final users, the
  // creator — without needing the unrelated USERS:READ permission. Keyed by
  // userId; a commit missing from this map means user-service couldn't resolve
  // it (frontend falls back to showing the raw id or "unknown user").
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  participantNames!: Record<string, string>;

  static from(
    workflow: Workflow,
    actions: WorkflowApprovalAction[] = [],
    activeAdminCycle?: WorkflowAdminCycle,
    allAdminCycles: WorkflowAdminCycle[] = [],
    participantNames: Record<string, string> = {},
  ): WorkflowResponseDto {
    return {
      id:                       workflow.id,
      orgId:                    workflow.orgId,
      title:                    workflow.title,
      description:              workflow.description,
      typologyId:               workflow.typologyId,
      typologyCode:             workflow.typologyCode,
      typologyVersion:          workflow.typologyVersion,
      typologyName:             workflow.typologyName,
      reviewCycleEnabled:       workflow.reviewCycleEnabled,
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
      notes: (workflow.notes ?? [])
        .filter((n) => n.cycleId === null)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(WorkflowNoteResponseDto.from),
      activeAdminCycle:         activeAdminCycle ? AdminCycleResponseDto.from(activeAdminCycle) : null,
      adminCycles:              allAdminCycles.map(AdminCycleResponseDto.from),
      createdAt:                workflow.createdAt,
      updatedAt:                workflow.updatedAt,
      participantNames,
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
