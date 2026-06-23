import {
  AdminCycleResponseDto,
  WorkflowResponseDto,
} from './workflow-response.dto';
import {
  AdminCycleStatus,
  AdminStepStatus,
  ApprovalActionType,
  ApprovalStepStatus,
  AttachmentType,
  WorkflowStatus,
} from '../entities/enums';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

function makeAdminCycle() {
  return {
    id: 'cycle-1',
    workflowId: 'wf-1',
    cycleNumber: 1,
    initiatedBy: 'user-1',
    status: AdminCycleStatus.IN_PROGRESS,
    currentStepOrder: 1,
    completedAt: null,
    allowedOptionalReviewerIds: null,
    steps: [
      {
        id: 'admin-step-1',
        cycleId: 'cycle-1',
        userId: 'reviewer-1',
        stepOrder: 1,
        status: AdminStepStatus.PENDING,
        isOptional: false,
        insertedByStepId: null,
        completedAt: null,
        notes: [
          {
            id: 'note-1',
            content: 'Looks good',
            createdBy: 'reviewer-1',
            createdAt,
          },
        ],
        attachments: [
          {
            id: 'admin-att-1',
            storageKey: 'admin/file.pdf',
            originalName: 'file.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 100,
            uploadedBy: 'reviewer-1',
            createdAt,
          },
        ],
      },
    ],
    createdAt,
  };
}

describe('Workflow response DTO mappers', () => {
  it('maps admin cycles with nested notes and attachments', () => {
    const dto = AdminCycleResponseDto.from(makeAdminCycle() as any);

    expect(dto.allowedOptionalReviewerIds).toEqual([]);
    expect(dto.steps[0]).toEqual(
      expect.objectContaining({
        id: 'admin-step-1',
        status: AdminStepStatus.PENDING,
        notes: [expect.objectContaining({ content: 'Looks good' })],
        attachments: [expect.objectContaining({ storageKey: 'admin/file.pdf' })],
      }),
    );
  });

  it('maps workflow aggregates with actions, attachments and admin cycles', () => {
    const adminCycle = makeAdminCycle();
    const workflow = {
      id: 'wf-1',
      orgId: 'org-1',
      title: 'Workflow',
      description: 'Description',
      typologyId: 'typology-1',
      typologyCode: 'TYP',
      typologyVersion: '1',
      typologyName: 'Typology',
      mainDocumentId: 'doc-1',
      mainDocumentValidated: true,
      mainDocumentMetadata: { ok: true },
      status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS,
      currentApprovalStepOrder: null,
      currentAssignedUserId: 'reviewer-1',
      finalUserIds: ['final-1'],
      createdBy: 'creator-1',
      closedBy: null,
      closedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      approvalSteps: [
        {
          id: 'step-1',
          workflowId: 'wf-1',
          userId: 'approver-1',
          stepOrder: 1,
          status: ApprovalStepStatus.APPROVED,
          completedAt: updatedAt,
        },
      ],
      attachments: [
        {
          id: 'att-1',
          workflowId: 'wf-1',
          uploadedBy: 'creator-1',
          storageKey: 'workflow/file.pdf',
          originalName: 'file.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: null,
          attachmentType: AttachmentType.SUPPORTING,
          createdAt,
        },
      ],
      createdAt,
      updatedAt,
    };
    const actions = [
      {
        id: 'action-1',
        workflowId: 'wf-1',
        stepId: 'step-1',
        userId: 'approver-1',
        action: ApprovalActionType.APPROVED,
        observations: null,
        attemptNumber: 1,
        attachments: undefined,
        createdAt,
      },
    ];

    const dto = WorkflowResponseDto.from(
      workflow as any,
      actions as any,
      adminCycle as any,
      [adminCycle] as any,
    );

    expect(dto.approvalSteps[0].status).toBe(ApprovalStepStatus.APPROVED);
    expect(dto.approvalActions[0].attachments).toEqual([]);
    expect(dto.attachments[0].attachmentType).toBe(AttachmentType.SUPPORTING);
    expect(dto.activeAdminCycle?.steps[0].notes[0].content).toBe('Looks good');
    expect(dto.adminCycles).toHaveLength(1);
  });
});
