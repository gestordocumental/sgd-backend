import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, Repository, ObjectLiteral } from 'typeorm';
import { WorkflowApprovalService } from './workflow-approval.service';
import { Workflow } from './entities/workflow.entity';
import { WorkflowApprovalStep } from './entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './entities/workflow-approval-action.entity';
import {
  WorkflowStatus,
  ApprovalStepStatus,
  TimelineEventType,
} from './entities/enums';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { AppLogger, KafkaProducerService } from '@sgd/common';
import { UserClientService } from '../common/clients/user-client.service';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkflowApprovalStep> = {}): WorkflowApprovalStep {
  return {
    id: 'step-1',
    workflowId: 'wf-1',
    userId: 'approver-1',
    stepOrder: 1,
    status: ApprovalStepStatus.PENDING,
    ...overrides,
  } as WorkflowApprovalStep;
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    orgId: 'org-1',
    title: 'Test WF',
    status: WorkflowStatus.DRAFT,
    createdBy: 'creator-1',
    mainDocumentValidated: true,
    approvalSteps: [makeStep()],
    currentApprovalStepOrder: null,
    currentAssignedUserId: null,
    finalUserIds: null,
    rejectedAtStepId: null,
    mainDocumentMetadata: null,
    ...overrides,
  } as unknown as Workflow;
}

function makeRepo<T extends ObjectLiteral>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function makeDataSource() {
  const manager = {
    save: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue(undefined),
  };
  return {
    transaction: jest.fn().mockImplementation(async (fn: (m: typeof manager) => Promise<void>) => {
      await fn(manager);
    }),
    _manager: manager,
  } as unknown as jest.Mocked<DataSource> & { _manager: typeof manager };
}

function buildService() {
  const workflowRepo = makeRepo<Workflow>();
  const stepRepo = makeRepo<WorkflowApprovalStep>();
  const actionRepo = makeRepo<WorkflowApprovalAction>();
  const dataSource = makeDataSource();

  const timelineService: jest.Mocked<WorkflowTimelineService> = {
    record: jest.fn().mockResolvedValue({ id: 'tl-1' }),
    getTimeline: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowTimelineService>;

  const kafkaProducer: jest.Mocked<KafkaProducerService> = {
    emitSafe: jest.fn(),
  } as unknown as jest.Mocked<KafkaProducerService>;

  const userClientService: jest.Mocked<UserClientService> = {
    getUsersByPosition: jest.fn().mockResolvedValue({ users: [{ id: 'final-user-1' }] }),
  } as unknown as jest.Mocked<UserClientService>;

  const logger: jest.Mocked<AppLogger> = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;

  const service = new WorkflowApprovalService(
    workflowRepo,
    stepRepo,
    actionRepo,
    dataSource,
    timelineService,
    kafkaProducer,
    userClientService,
    logger,
  );

  return { service, workflowRepo, stepRepo, actionRepo, dataSource, timelineService, kafkaProducer, userClientService };
}

// ── startApproval ─────────────────────────────────────────────────────────────

describe('WorkflowApprovalService', () => {
  describe('startApproval()', () => {
    it('throws BadRequestException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);
      await expect(service.startApproval('wf-1', 'creator-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when caller is not the creator', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());
      await expect(service.startApproval('wf-1', 'not-creator')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when workflow is not DRAFT', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.PENDING_APPROVAL }),
      );
      await expect(service.startApproval('wf-1', 'creator-1')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when no approvers defined', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow({ approvalSteps: [] }));
      await expect(service.startApproval('wf-1', 'creator-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when main document is not validated', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow({ mainDocumentValidated: false }));
      await expect(service.startApproval('wf-1', 'creator-1')).rejects.toThrow(BadRequestException);
    });

    it('transitions workflow to PENDING_APPROVAL and emits kafka events', async () => {
      const { service, workflowRepo, dataSource, kafkaProducer } = buildService();
      const wf = makeWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.startApproval('wf-1', 'creator-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.PENDING_APPROVAL }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2); // APPROVAL_STARTED + NOTIFICATION_SEND
    });

    it('records APPROVAL_STARTED timeline event inside transaction', async () => {
      const { service, workflowRepo, timelineService } = buildService();
      const wf = makeWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.startApproval('wf-1', 'creator-1');

      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.APPROVAL_STARTED }),
        expect.anything(),
      );
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────────

  describe('approve()', () => {
    function pendingWorkflow(overrides: Partial<Workflow> = {}) {
      return makeWorkflow({
        status: WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: 1,
        currentAssignedUserId: 'approver-1',
        approvalSteps: [makeStep({ status: ApprovalStepStatus.PENDING })],
        ...overrides,
      });
    }

    it('throws BadRequestException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);
      await expect(service.approve('wf-1', 'approver-1', {})).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when workflow not in PENDING_APPROVAL', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());
      await expect(service.approve('wf-1', 'approver-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not the current approver', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(pendingWorkflow());
      await expect(service.approve('wf-1', 'not-approver', {})).rejects.toThrow(ForbiddenException);
    });

    it('approves last step and transitions to PENDING_REVIEW_CYCLE', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = pendingWorkflow({
        mainDocumentMetadata: {
          typologyOrgStructure: { cargoId: 'cargo-1' },
        } as unknown as Record<string, unknown>,
      });
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.approve('wf-1', 'approver-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.PENDING_REVIEW_CYCLE }),
      );
    });

    it('resolves final users from workflow when already set', async () => {
      const { service, workflowRepo, dataSource, userClientService } = buildService();
      const wf = pendingWorkflow({ finalUserIds: ['preset-user'] });
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.approve('wf-1', 'approver-1', {});

      // Should NOT call user-service when finalUserIds already set
      expect(userClientService.getUsersByPosition).not.toHaveBeenCalled();
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ finalUserIds: ['preset-user'] }),
      );
    });

    it('advances to next step when not last approver', async () => {
      const step1 = makeStep({ id: 'step-1', stepOrder: 1, status: ApprovalStepStatus.PENDING });
      const step2 = makeStep({ id: 'step-2', stepOrder: 2, status: ApprovalStepStatus.WAITING, userId: 'approver-2' });
      const wf = pendingWorkflow({ approvalSteps: [step1, step2] });
      const { service, workflowRepo, dataSource, kafkaProducer } = buildService();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.approve('wf-1', 'approver-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowApprovalStep,
        'step-2',
        expect.objectContaining({ status: ApprovalStepStatus.PENDING }),
      );
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ currentApprovalStepOrder: 2 }),
      );
    });

    it('emits WORKFLOW_APPROVED kafka event when last step approved', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      const wf = pendingWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.approve('wf-1', 'approver-1', {});

      const calls = (kafkaProducer.emitSafe as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(calls.some((topic) => topic.includes('approval.completed'))).toBe(true);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────────────

  describe('reject()', () => {
    function pendingWorkflow() {
      return makeWorkflow({
        status: WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: 1,
        currentAssignedUserId: 'approver-1',
        approvalSteps: [makeStep({ status: ApprovalStepStatus.PENDING })],
      });
    }

    it('throws BadRequestException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);
      await expect(service.reject('wf-1', 'approver-1', { observations: 'bad' })).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when workflow not in PENDING_APPROVAL', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());
      await expect(service.reject('wf-1', 'approver-1', { observations: 'bad' })).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not the current approver', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(pendingWorkflow());
      await expect(service.reject('wf-1', 'not-approver', { observations: 'bad' })).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to REJECTED', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = pendingWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.reject('wf-1', 'approver-1', { observations: 'needs work' });

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.REJECTED }),
      );
    });

    it('records STEP_REJECTED timeline event', async () => {
      const { service, workflowRepo, timelineService } = buildService();
      const wf = pendingWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.reject('wf-1', 'approver-1', { observations: 'obs' });

      const eventTypes = (timelineService.record as jest.Mock).mock.calls.map(
        (c: [{ eventType: TimelineEventType }]) => c[0].eventType,
      );
      expect(eventTypes).toContain(TimelineEventType.STEP_REJECTED);
    });

    it('notifies the workflow creator when rejected', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      const wf = pendingWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.reject('wf-1', 'approver-1', { observations: 'motivo de rechazo' });

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        'notification.send',
        expect.objectContaining({
          type: 'WORKFLOW_REJECTED',
          recipientUserIds: expect.arrayContaining(['creator-1']),
        }),
      );
    });

    it('also notifies final users when the workflow has finalUserIds', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      const wf = makeWorkflow({
        status: WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: 1,
        currentAssignedUserId: 'approver-1',
        approvalSteps: [makeStep({ status: ApprovalStepStatus.PENDING })],
        finalUserIds: ['final-user-1', 'final-user-2'],
      });
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.reject('wf-1', 'approver-1', { observations: 'motivo de rechazo' });

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        'notification.send',
        expect.objectContaining({
          type: 'WORKFLOW_REJECTED',
          recipientUserIds: expect.arrayContaining(['creator-1', 'final-user-1', 'final-user-2']),
        }),
      );
    });
  });

  // ── resubmit ─────────────────────────────────────────────────────────────────

  describe('resubmit()', () => {
    function returnedWorkflow() {
      const step = makeStep({ id: 'step-1', status: ApprovalStepStatus.REJECTED });
      return makeWorkflow({
        status: WorkflowStatus.RETURNED_TO_CREATOR,
        createdBy: 'creator-1',
        rejectedAtStepId: 'step-1',
        approvalSteps: [step],
      });
    }

    it('throws BadRequestException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);
      await expect(service.resubmit('wf-1', 'creator-1', {})).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when workflow not in RETURNED_TO_CREATOR', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());
      await expect(service.resubmit('wf-1', 'creator-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not the creator', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(returnedWorkflow());
      await expect(service.resubmit('wf-1', 'not-creator', {})).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow back to PENDING_APPROVAL', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = returnedWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.resubmit('wf-1', 'creator-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.PENDING_APPROVAL }),
      );
    });

    it('re-activates the rejected step to PENDING', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = returnedWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.resubmit('wf-1', 'creator-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowApprovalStep,
        'step-1',
        expect.objectContaining({ status: ApprovalStepStatus.PENDING }),
      );
    });

    it('updates mainDocumentId when updatedMainDocumentId provided', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = returnedWorkflow();
      workflowRepo.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.resubmit('wf-1', 'creator-1', { updatedMainDocumentId: 'new-doc-key' });

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({
          mainDocumentId: 'new-doc-key',
          mainDocumentValidated: false,
        }),
      );
    });
  });

  // ── resolveFinalUsers error path ──────────────────────────────────────────────

  describe('resolveFinalUsers (error path)', () => {
    it('throws InternalServerErrorException when user-service is unavailable', async () => {
      const { service, workflowRepo, userClientService } = buildService();
      userClientService.getUsersByPosition.mockRejectedValue(new Error('Connection refused'));

      const wf = makeWorkflow({
        status: WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: 1,
        currentAssignedUserId: 'approver-1',
        approvalSteps: [makeStep({ status: ApprovalStepStatus.PENDING })],
        mainDocumentMetadata: {
          typologyOrgStructure: { cargoId: 'cargo-1' },
        } as unknown as Record<string, unknown>,
      });
      workflowRepo.findOne.mockResolvedValue(wf);

      await expect(service.approve('wf-1', 'approver-1', {})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
