import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ApproveAttachmentDto,
  ApproveWorkflowDto,
} from './approve-workflow.dto';
import {
  ApproverStepDto,
  CreateWorkflowDto,
  WorkflowFileDto,
} from './create-workflow.dto';
import { ListWorkflowsDto } from './list-workflows.dto';
import { UpdateWorkflowDto } from './update-workflow.dto';
import { CloseWorkflowDto } from './close-workflow.dto';
import { RejectWorkflowDto } from './reject-workflow.dto';
import { NotifyNoFinalUsersDto } from './notify-no-final-users.dto';
import { AdminStepInputDto, CreateAdminCycleDto } from './create-admin-cycle.dto';
import { AdminStepAttachmentDto, CompleteAdminStepDto } from './complete-admin-step.dto';
import { ForwardAdminStepDto } from './forward-admin-step.dto';
import { WorkflowStatus } from '../entities/enums';

const UUID = '11111111-1111-4111-8111-111111111111';
const TYPOLOGY_ID = '507f1f77bcf86cd799439011';

const filePayload = {
  storageKey: 'workflows/file.pdf',
  originalName: 'file.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 42,
};

describe('Workflow input DTOs', () => {
  // ─── Original DTOs ────────────────────────────────────────────────────────

  it('transforms and validates create workflow payloads', async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      title: '  Contract approval  ',
      description: '  Initial review  ',
      typologyId: TYPOLOGY_ID,
      approvers: [{ userId: UUID, stepOrder: 1 }],
      mainDocument: filePayload,
      attachments: [filePayload],
      finalUserIds: [UUID],
    });

    expect(dto.title).toBe('Contract approval');
    expect(dto.description).toBe('Initial review');
    expect(dto.approvers[0]).toBeInstanceOf(ApproverStepDto);
    expect(dto.mainDocument).toBeInstanceOf(WorkflowFileDto);
    expect(dto.attachments?.[0]).toBeInstanceOf(WorkflowFileDto);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('transforms and validates update workflow payloads', async () => {
    const dto = plainToInstance(UpdateWorkflowDto, {
      title: '  Updated title  ',
      description: '  Updated description  ',
      mainDocument: filePayload,
      attachments: [filePayload],
      approvers: [{ userId: UUID, stepOrder: 1 }],
      finalUserIds: [UUID],
    });

    expect(dto.title).toBe('Updated title');
    expect(dto.description).toBe('Updated description');
    expect(dto.approvers?.[0]).toBeInstanceOf(ApproverStepDto);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('transforms and validates approval attachments', async () => {
    const dto = plainToInstance(ApproveWorkflowDto, {
      observations: '  approved  ',
      attachments: [{ ...filePayload, fileSizeBytes: '42' }],
    });

    expect(dto.observations).toBe('approved');
    expect(dto.attachments?.[0]).toBeInstanceOf(ApproveAttachmentDto);
    expect(dto.attachments?.[0].fileSizeBytes).toBe(42);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('transforms and validates list query pagination', async () => {
    const dto = plainToInstance(ListWorkflowsDto, {
      status: WorkflowStatus.DRAFT,
      createdBy: UUID,
      page: '2',
      limit: '50',
    });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  // ─── CloseWorkflowDto ─────────────────────────────────────────────────────

  it('validates close workflow with optional closing notes', async () => {
    const dto = plainToInstance(CloseWorkflowDto, { closingNotes: '  closing notes  ' });
    expect(dto.closingNotes).toBe('closing notes');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('validates close workflow without closing notes (field is optional)', async () => {
    const dto = plainToInstance(CloseWorkflowDto, {});
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  // ─── RejectWorkflowDto ────────────────────────────────────────────────────

  it('transforms and validates reject workflow observations', async () => {
    const dto = plainToInstance(RejectWorkflowDto, {
      observations: '  This document needs revision  ',
    });
    expect(dto.observations).toBe('This document needs revision');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('fails validation when reject observations is shorter than 10 characters', async () => {
    const dto = plainToInstance(RejectWorkflowDto, { observations: 'short' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── NotifyNoFinalUsersDto ────────────────────────────────────────────────

  it('validates notify-no-final-users payload', async () => {
    const dto = plainToInstance(NotifyNoFinalUsersDto, {
      typologyId:    TYPOLOGY_ID,
      typologyName:  'Standard Review',
      recipientIds:  [UUID],
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('fails validation when recipientIds is empty', async () => {
    const dto = plainToInstance(NotifyNoFinalUsersDto, {
      typologyId:   TYPOLOGY_ID,
      typologyName: 'Standard Review',
      recipientIds: [],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── CreateAdminCycleDto ─────────────────────────────────────────────────

  it('transforms and validates create-admin-cycle payload', async () => {
    const dto = plainToInstance(CreateAdminCycleDto, {
      steps: [{ userId: UUID, stepOrder: 1 }],
      allowedOptionalReviewerIds: [UUID],
    });
    expect(dto.steps[0]).toBeInstanceOf(AdminStepInputDto);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('validates create-admin-cycle without optional reviewers', async () => {
    const dto = plainToInstance(CreateAdminCycleDto, {
      steps: [{ userId: UUID, stepOrder: 1 }],
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('fails create-admin-cycle validation when steps array is empty', async () => {
    const dto = plainToInstance(CreateAdminCycleDto, { steps: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── CompleteAdminStepDto ─────────────────────────────────────────────────

  it('transforms and validates complete-admin-step with notes and attachments', async () => {
    const dto = plainToInstance(CompleteAdminStepDto, {
      notes: '  reviewed and approved  ',
      attachments: [{
        storageKey: 'files/review.pdf',
        originalName: 'review.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
      }],
    });
    expect(dto.notes).toBe('reviewed and approved');
    expect(dto.attachments?.[0]).toBeInstanceOf(AdminStepAttachmentDto);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('validates complete-admin-step with no notes or attachments (both optional)', async () => {
    const dto = plainToInstance(CompleteAdminStepDto, {});
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  // ─── ForwardAdminStepDto ─────────────────────────────────────────────────

  it('transforms and validates forward-admin-step with notes and attachments', async () => {
    const dto = plainToInstance(ForwardAdminStepDto, {
      optionalReviewerId: UUID,
      notes: '  forwarding for additional review  ',
      attachments: [{
        storageKey: 'files/context.pdf',
        originalName: 'context.pdf',
        mimeType: 'application/pdf',
      }],
    });
    expect(dto.notes).toBe('forwarding for additional review');
    expect(dto.attachments?.[0]).toBeInstanceOf(AdminStepAttachmentDto);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('validates forward-admin-step without optional fields', async () => {
    const dto = plainToInstance(ForwardAdminStepDto, { optionalReviewerId: UUID });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('fails forward-admin-step validation when optionalReviewerId is not a UUID', async () => {
    const dto = plainToInstance(ForwardAdminStepDto, { optionalReviewerId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
