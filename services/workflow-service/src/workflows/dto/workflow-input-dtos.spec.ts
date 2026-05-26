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
});
