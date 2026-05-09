import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository, ObjectLiteral } from 'typeorm';
import { WorkflowAdminCycleService } from './workflow-admin-cycle.service';
import { Workflow } from './entities/workflow.entity';
import { WorkflowAdminCycle } from './entities/workflow-admin-cycle.entity';
import { WorkflowAdminStep } from './entities/workflow-admin-step.entity';
import { WorkflowAdminAttachment } from './entities/workflow-admin-attachment.entity';
import { WorkflowNote } from './entities/workflow-note.entity';
import {
  WorkflowStatus,
  AdminCycleStatus,
  AdminStepStatus,
  TimelineEventType,
} from './entities/enums';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    orgId: 'org-1',
    title: 'Test WF',
    status: WorkflowStatus.PENDING_REVIEW_CYCLE,
    createdBy: 'creator-1',
    finalUserIds: ['final-user-1'],
    activeAdminCycleId: null,
    ...overrides,
  } as unknown as Workflow;
}

function makeAdminStep(overrides: Partial<WorkflowAdminStep> = {}): WorkflowAdminStep {
  return {
    id: 'astep-1',
    cycleId: 'cycle-1',
    workflowId: 'wf-1',
    userId: 'admin-user-1',
    stepOrder: 1,
    status: AdminStepStatus.PENDING,
    ...overrides,
  } as WorkflowAdminStep;
}

function makeCycle(overrides: Partial<WorkflowAdminCycle> = {}): WorkflowAdminCycle {
  return {
    id: 'cycle-1',
    workflowId: 'wf-1',
    cycleNumber: 1,
    initiatedBy: 'final-user-1',
    status: AdminCycleStatus.IN_PROGRESS,
    currentStepOrder: 1,
    steps: [makeAdminStep()],
    ...overrides,
  } as unknown as WorkflowAdminCycle;
}

function makeRepo<T extends ObjectLiteral>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Repository<T>>;
}

function makeDataSource() {
  const manager = {
    save: jest.fn().mockResolvedValue({ id: 'new-id' }),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((_Entity: unknown, data: unknown) => data as object),
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
  const cycleRepo = makeRepo<WorkflowAdminCycle>();
  const stepRepo = makeRepo<WorkflowAdminStep>();
  const attachmentRepo = makeRepo<WorkflowAdminAttachment>();
  const noteRepo = makeRepo<WorkflowNote>();
  const dataSource = makeDataSource();

  const timelineService: jest.Mocked<WorkflowTimelineService> = {
    record: jest.fn().mockResolvedValue({ id: 'tl-1' }),
    getTimeline: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowTimelineService>;

  const kafkaProducer: jest.Mocked<KafkaProducerService> = {
    emitSafe: jest.fn(),
  } as unknown as jest.Mocked<KafkaProducerService>;

  const service = new WorkflowAdminCycleService(
    workflowRepo,
    cycleRepo,
    stepRepo,
    attachmentRepo,
    noteRepo,
    dataSource,
    timelineService,
    kafkaProducer,
  );

  return { service, workflowRepo, cycleRepo, stepRepo, dataSource, timelineService, kafkaProducer };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowAdminCycleService', () => {
  describe('createCycle()', () => {
    const validDto = {
      steps: [{ userId: 'admin-user-1', stepOrder: 1 }],
    };

    it('throws ConflictException when workflow is not in PENDING_REVIEW_CYCLE or AVAILABLE', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(service.createCycle('wf-1', 'final-user-1', validDto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when there is already an active admin cycle', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow({ activeAdminCycleId: 'existing-cycle' }));
      await expect(service.createCycle('wf-1', 'final-user-1', validDto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a designated final user', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      await expect(service.createCycle('wf-1', 'not-final-user', validDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for non-consecutive step orders', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      await expect(
        service.createCycle('wf-1', 'final-user-1', {
          steps: [
            { userId: 'u1', stepOrder: 1 },
            { userId: 'u2', stepOrder: 3 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for duplicate step orders', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      await expect(
        service.createCycle('wf-1', 'final-user-1', {
          steps: [
            { userId: 'u1', stepOrder: 1 },
            { userId: 'u2', stepOrder: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a cycle, updates workflow status and emits kafka events on success', async () => {
      const { service, workflowRepo, cycleRepo, dataSource, kafkaProducer } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      cycleRepo.findOne.mockResolvedValue(null); // no previous cycle
      const savedCycle = makeCycle();
      dataSource._manager.save.mockResolvedValue({ id: 'cycle-1' });
      cycleRepo.findOneOrFail.mockResolvedValue(savedCycle);

      await service.createCycle('wf-1', 'final-user-1', validDto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2);
    });

    it('increments cycle number based on last existing cycle', async () => {
      const { service, workflowRepo, cycleRepo, dataSource } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      cycleRepo.findOne.mockResolvedValue(makeCycle({ cycleNumber: 3 }));
      cycleRepo.findOneOrFail.mockResolvedValue(makeCycle({ cycleNumber: 4 }));

      await service.createCycle('wf-1', 'final-user-1', validDto);

      const cycleSaveCall = (dataSource._manager.save as jest.Mock).mock.calls.find(
        (c: [unknown, unknown]) => c[0] === WorkflowAdminCycle,
      );
      expect(cycleSaveCall?.[1]).toEqual(
        expect.objectContaining({ cycleNumber: 4 }),
      );
    });

    it('also works when workflow is AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, workflowRepo, cycleRepo, dataSource } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
      cycleRepo.findOne.mockResolvedValue(null);
      cycleRepo.findOneOrFail.mockResolvedValue(makeCycle());

      await expect(service.createCycle('wf-1', 'final-user-1', validDto)).resolves.toBeDefined();
    });
  });

  describe('completeStep()', () => {
    it('throws ConflictException when workflow not in ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when cycle not found', async () => {
      const { service, workflowRepo, cycleRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(null);
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when cycle is not IN_PROGRESS', async () => {
      const { service, workflowRepo, cycleRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle({ status: AdminCycleStatus.COMPLETED }));
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when step not found in cycle', async () => {
      const { service, workflowRepo, cycleRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle({ steps: [] }));
      await expect(service.completeStep('wf-1', 'cycle-1', 'missing-step', 'admin-user-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user is not assigned to the step', async () => {
      const { service, workflowRepo, cycleRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle());
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'wrong-user', {})).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when step is not PENDING', async () => {
      const { service, workflowRepo, cycleRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(
        makeCycle({ steps: [makeAdminStep({ status: AdminStepStatus.COMPLETED })] }),
      );
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {})).rejects.toThrow(ConflictException);
    });

    it('completes last step: cycle becomes COMPLETED, workflow to AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, workflowRepo, cycleRepo, dataSource, stepRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle()); // single step = last step
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowAdminCycle,
        'cycle-1',
        expect.objectContaining({ status: AdminCycleStatus.COMPLETED }),
      );
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
    });

    it('advances to next step when not last', async () => {
      const step1 = makeAdminStep({ id: 'astep-1', stepOrder: 1 });
      const step2 = makeAdminStep({ id: 'astep-2', stepOrder: 2, userId: 'admin-user-2', status: AdminStepStatus.WAITING });
      const { service, workflowRepo, cycleRepo, dataSource, stepRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle({ steps: [step1, step2] }));
      stepRepo.findOneOrFail.mockResolvedValue(step1);

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowAdminStep,
        'astep-2',
        expect.objectContaining({ status: AdminStepStatus.PENDING }),
      );
    });

    it('saves a note when dto.notes is provided', async () => {
      const { service, workflowRepo, cycleRepo, dataSource, stepRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {
        notes: '  Important note  ',
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ content: 'Important note' }),
      );
    });

    it('does not save a note when dto.notes is empty', async () => {
      const { service, workflowRepo, cycleRepo, dataSource, stepRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', { notes: '   ' });

      const noteSaveCalls = (dataSource._manager.save as jest.Mock).mock.calls.filter(
        (c: [unknown]) => c[0] === WorkflowNote,
      );
      expect(noteSaveCalls).toHaveLength(0);
    });

    it('records ADMIN_STEP_COMPLETED and ADMIN_CYCLE_COMPLETED timeline events on last step', async () => {
      const { service, workflowRepo, cycleRepo, timelineService, stepRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      cycleRepo.findOne.mockResolvedValue(makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', {});

      const eventTypes = (timelineService.record as jest.Mock).mock.calls.map(
        (c: [{ eventType: TimelineEventType }]) => c[0].eventType,
      );
      expect(eventTypes).toContain(TimelineEventType.ADMIN_STEP_COMPLETED);
      expect(eventTypes).toContain(TimelineEventType.ADMIN_CYCLE_COMPLETED);
    });
  });

  describe('skipReviewCycle()', () => {
    it('throws ConflictException when workflow not in PENDING_REVIEW_CYCLE', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(service.skipReviewCycle('wf-1', 'final-user-1')).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a final user', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(makeWorkflow());
      await expect(service.skipReviewCycle('wf-1', 'not-final-user')).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      const wf = makeWorkflow();
      workflowRepo.findOneOrFail
        .mockResolvedValueOnce(wf)
        .mockResolvedValueOnce(makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }));
      workflowRepo.update.mockResolvedValue(undefined as never);

      await service.skipReviewCycle('wf-1', 'final-user-1');

      expect(workflowRepo.update).toHaveBeenCalledWith(
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalled();
    });
  });

  describe('finalizeCycle()', () => {
    it('throws ConflictException when cycle is not COMPLETED', async () => {
      const { service, cycleRepo } = buildService();
      cycleRepo.findOneOrFail.mockResolvedValue(makeCycle({ status: AdminCycleStatus.IN_PROGRESS }));
      await expect(service.finalizeCycle('wf-1', 'cycle-1', 'final-user-1')).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user did not initiate the cycle', async () => {
      const { service, cycleRepo } = buildService();
      cycleRepo.findOneOrFail.mockResolvedValue(
        makeCycle({ status: AdminCycleStatus.COMPLETED, initiatedBy: 'other-user' }),
      );
      await expect(service.finalizeCycle('wf-1', 'cycle-1', 'final-user-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns the cycle when already COMPLETED and caller is initiator', async () => {
      const { service, cycleRepo } = buildService();
      const cycle = makeCycle({ status: AdminCycleStatus.COMPLETED });
      cycleRepo.findOneOrFail.mockResolvedValue(cycle);

      const result = await service.finalizeCycle('wf-1', 'cycle-1', 'final-user-1');
      expect(result).toBe(cycle);
    });
  });

  describe('closeWorkflow()', () => {
    it('throws ConflictException when workflow is ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      await expect(service.closeWorkflow('wf-1', 'final-user-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when workflow is not AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.DRAFT }),
      );
      await expect(service.closeWorkflow('wf-1', 'final-user-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a final user', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
      await expect(service.closeWorkflow('wf-1', 'not-final-user', {})).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to CLOSED and emits kafka events', async () => {
      const { service, workflowRepo, dataSource, kafkaProducer } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      workflowRepo.findOneOrFail
        .mockResolvedValueOnce(wf)
        .mockResolvedValueOnce(makeWorkflow({ status: WorkflowStatus.CLOSED }));

      await service.closeWorkflow('wf-1', 'final-user-1', { closingNotes: 'Done' });

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.CLOSED }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2); // CLOSED + NOTIFICATION_SEND
    });

    it('saves closing notes when provided', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      workflowRepo.findOneOrFail
        .mockResolvedValueOnce(wf)
        .mockResolvedValueOnce(makeWorkflow({ status: WorkflowStatus.CLOSED }));

      await service.closeWorkflow('wf-1', 'final-user-1', { closingNotes: '  Closing note  ' });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ content: 'Closing note' }),
      );
    });

    it('does not save note when closingNotes is empty/whitespace', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      workflowRepo.findOneOrFail
        .mockResolvedValueOnce(wf)
        .mockResolvedValueOnce(makeWorkflow({ status: WorkflowStatus.CLOSED }));

      await service.closeWorkflow('wf-1', 'final-user-1', { closingNotes: '   ' });

      const noteSaveCalls = (dataSource._manager.save as jest.Mock).mock.calls.filter(
        (c: [unknown]) => c[0] === WorkflowNote,
      );
      expect(noteSaveCalls).toHaveLength(0);
    });

    it('records WORKFLOW_CLOSED timeline event', async () => {
      const { service, workflowRepo, timelineService } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      workflowRepo.findOneOrFail
        .mockResolvedValueOnce(wf)
        .mockResolvedValueOnce(makeWorkflow({ status: WorkflowStatus.CLOSED }));

      await service.closeWorkflow('wf-1', 'final-user-1', {});

      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.WORKFLOW_CLOSED }),
        expect.anything(),
      );
    });
  });
});
