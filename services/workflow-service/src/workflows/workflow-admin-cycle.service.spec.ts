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
import { WorkflowAttachment } from './entities/workflow-attachment.entity';
import { WorkflowNote } from './entities/workflow-note.entity';
import {
  WorkflowStatus,
  AdminCycleStatus,
  AdminStepStatus,
  AttachmentType,
  TimelineEventType,
} from './entities/enums';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService, AppLogger } from '@sgd/common';
import { DocumentClientService } from '../common/clients/document-client.service';

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
    findOne: jest.fn(),
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

  const documentClientService: jest.Mocked<DocumentClientService> = {
    isReviewCycleEnabledForTypology: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<DocumentClientService>;

  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as AppLogger;

  const service = new WorkflowAdminCycleService(
    workflowRepo,
    cycleRepo,
    stepRepo,
    attachmentRepo,
    noteRepo,
    dataSource,
    timelineService,
    kafkaProducer,
    documentClientService,
    logger,
  );

  return {
    service,
    workflowRepo,
    cycleRepo,
    stepRepo,
    dataSource,
    timelineService,
    kafkaProducer,
    documentClientService,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowAdminCycleService', () => {
  describe('createCycle()', () => {
    const validDto = {
      steps: [{ userId: 'admin-user-1', stepOrder: 1 }],
    };

    function mockLookups(
      dataSource: ReturnType<typeof makeDataSource>,
      workflow: Workflow | null,
      lastCycle: WorkflowAdminCycle | null = null,
    ) {
      dataSource._manager.findOne.mockImplementation((entity: unknown) => {
        if (entity === WorkflowAdminCycle) return Promise.resolve(lastCycle);
        return Promise.resolve(workflow);
      });
    }

    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.createCycle('wf-1', 'final-user-1', 'org-2', validDto),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow is not in PENDING_REVIEW_CYCLE or AVAILABLE', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(service.createCycle('wf-1', 'final-user-1', 'org-1', validDto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when there is already an active admin cycle', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ activeAdminCycleId: 'existing-cycle' }));
      await expect(service.createCycle('wf-1', 'final-user-1', 'org-1', validDto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a designated final user', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow());
      await expect(service.createCycle('wf-1', 'not-final-user', 'org-1', validDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the review cycle is disabled for the typology (defense in depth), without touching the locked workflow row', async () => {
      const { service, workflowRepo, dataSource, documentClientService } = buildService();
      workflowRepo.findOne.mockResolvedValue({ typologyId: 'typ-1' } as Workflow);
      documentClientService.isReviewCycleEnabledForTypology.mockResolvedValue(false);

      await expect(service.createCycle('wf-1', 'final-user-1', 'org-1', validDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'wf-1', orgId: 'org-1' },
        select: ['typologyId'],
      });
      expect(documentClientService.isReviewCycleEnabledForTypology).toHaveBeenCalledWith('org-1', 'typ-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('skips the review-cycle-enabled check without erroring when the preliminary workflow lookup finds nothing — the locked read inside the transaction surfaces the real not-found', async () => {
      const { service, workflowRepo, dataSource, documentClientService } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.createCycle('wf-1', 'final-user-1', 'org-2', validDto),
      ).rejects.toThrow(NotFoundException);
      expect(documentClientService.isReviewCycleEnabledForTypology).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for non-consecutive step orders, without touching the workflow row', async () => {
      const { service, dataSource } = buildService();
      await expect(
        service.createCycle('wf-1', 'final-user-1', 'org-1', {
          steps: [
            { userId: 'u1', stepOrder: 1 },
            { userId: 'u2', stepOrder: 3 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for duplicate step orders', async () => {
      const { service } = buildService();
      await expect(
        service.createCycle('wf-1', 'final-user-1', 'org-1', {
          steps: [
            { userId: 'u1', stepOrder: 1 },
            { userId: 'u2', stepOrder: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a cycle, updates workflow status and emits kafka events on success', async () => {
      const { service, cycleRepo, dataSource, kafkaProducer } = buildService();
      mockLookups(dataSource, makeWorkflow(), null); // no previous cycle
      const savedCycle = makeCycle();
      dataSource._manager.save.mockResolvedValue({ id: 'cycle-1' });
      cycleRepo.findOneOrFail.mockResolvedValue(savedCycle);

      await service.createCycle('wf-1', 'final-user-1', 'org-1', validDto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2);
    });

    it('increments cycle number based on last existing cycle', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow(), makeCycle({ cycleNumber: 3 }));

      await service.createCycle('wf-1', 'final-user-1', 'org-1', validDto);

      const cycleSaveCall = (dataSource._manager.save as jest.Mock).mock.calls.find(
        (c: [unknown, unknown]) => c[0] === WorkflowAdminCycle,
      );
      expect(cycleSaveCall?.[1]).toEqual(
        expect.objectContaining({ cycleNumber: 4 }),
      );
    });

    it('also works when workflow is AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, cycleRepo, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }), null);
      cycleRepo.findOneOrFail.mockResolvedValue(makeCycle());

      await expect(service.createCycle('wf-1', 'final-user-1', 'org-1', validDto)).resolves.toBeDefined();
    });
  });

  describe('completeStep()', () => {
    function mockLookups(
      dataSource: ReturnType<typeof makeDataSource>,
      workflow: Workflow | null,
      cycle: WorkflowAdminCycle | null,
    ) {
      dataSource._manager.findOne.mockImplementation((entity: unknown) => {
        if (entity === WorkflowAdminCycle) return Promise.resolve(cycle);
        return Promise.resolve(workflow);
      });
    }

    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-2', {}),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow not in ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.DRAFT }), null);
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when cycle not found', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), null);
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when cycle is not IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      mockLookups(
        dataSource,
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
        makeCycle({ status: AdminCycleStatus.COMPLETED }),
      );
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when step not found in cycle', async () => {
      const { service, dataSource } = buildService();
      mockLookups(
        dataSource,
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
        makeCycle({ steps: [] }),
      );
      await expect(service.completeStep('wf-1', 'cycle-1', 'missing-step', 'admin-user-1', 'org-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user is not assigned to the step', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle());
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'wrong-user', 'org-1', {})).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when step is not PENDING', async () => {
      const { service, dataSource } = buildService();
      mockLookups(
        dataSource,
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
        makeCycle({ steps: [makeAdminStep({ status: AdminStepStatus.COMPLETED })] }),
      );
      await expect(service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {})).rejects.toThrow(ConflictException);
    });

    it('completes last step: cycle becomes COMPLETED, workflow to AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle()); // single step = last step
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {});

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
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(
        dataSource,
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
        makeCycle({ steps: [step1, step2] }),
      );
      stepRepo.findOneOrFail.mockResolvedValue(step1);

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {});

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowAdminStep,
        'astep-2',
        expect.objectContaining({ status: AdminStepStatus.PENDING }),
      );
    });

    it('saves a note when dto.notes is provided', async () => {
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {
        notes: '  Important note  ',
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ content: 'Important note' }),
      );
    });

    it('does not save a note when dto.notes is empty', async () => {
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', { notes: '   ' });

      const noteSaveCalls = (dataSource._manager.save as jest.Mock).mock.calls.filter(
        (c: [unknown]) => c[0] === WorkflowNote,
      );
      expect(noteSaveCalls).toHaveLength(0);
    });

    it('saves attachments when dto.attachments is provided', async () => {
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {
        attachments: [
          { storageKey: 'att-key', originalName: 'doc.pdf', mimeType: 'application/pdf', fileSizeBytes: 1024 },
        ],
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowAdminAttachment,
        expect.arrayContaining([
          expect.objectContaining({ storageKey: 'att-key', uploadedBy: 'admin-user-1' }),
        ]),
      );
    });

    it('records ADMIN_STEP_COMPLETED and ADMIN_CYCLE_COMPLETED timeline events on last step', async () => {
      const { service, dataSource, timelineService, stepRepo } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }), makeCycle());
      stepRepo.findOneOrFail.mockResolvedValue(makeAdminStep());

      await service.completeStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {});

      const eventTypes = (timelineService.record as jest.Mock).mock.calls.map(
        (c: [{ eventType: TimelineEventType }]) => c[0].eventType,
      );
      expect(eventTypes).toContain(TimelineEventType.ADMIN_STEP_COMPLETED);
      expect(eventTypes).toContain(TimelineEventType.ADMIN_CYCLE_COMPLETED);
    });
  });

  describe('skipReviewCycle()', () => {
    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(service.skipReviewCycle('wf-1', 'final-user-1', 'org-2')).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow not in PENDING_REVIEW_CYCLE', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(service.skipReviewCycle('wf-1', 'final-user-1', 'org-1')).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a final user', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(makeWorkflow());
      await expect(service.skipReviewCycle('wf-1', 'not-final-user', 'org-1')).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, workflowRepo, dataSource, kafkaProducer } = buildService();
      const wf = makeWorkflow();
      dataSource._manager.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );

      await service.skipReviewCycle('wf-1', 'final-user-1', 'org-1');

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
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

  describe('forwardStep()', () => {
    const validDto = {
      optionalReviewerId: 'optional-user-1',
      notes: 'Forwarding for review',
    };

    function makeWfForForward() {
      return makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS });
    }

    function makeCycleForForward(overrides: Partial<WorkflowAdminCycle> = {}) {
      return makeCycle({
        allowedOptionalReviewerIds: ['optional-user-1'],
        steps: [makeAdminStep({ isOptional: false })],
        ...overrides,
      } as Partial<WorkflowAdminCycle>);
    }

    function addQbToManager(dataSource: ReturnType<typeof makeDataSource>) {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      (dataSource._manager as unknown as Record<string, unknown>).createQueryBuilder = jest.fn().mockReturnValue(qb);
      return qb;
    }

    function mockLookups(
      dataSource: ReturnType<typeof makeDataSource>,
      workflow: Workflow | null,
      cycle: WorkflowAdminCycle | null,
    ) {
      dataSource._manager.findOne.mockImplementation((entity: unknown) => {
        if (entity === WorkflowAdminCycle) return Promise.resolve(cycle);
        return Promise.resolve(workflow);
      });
    }

    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-2', validDto),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow is not ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWorkflow({ status: WorkflowStatus.DRAFT }), null);
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when cycle is not found', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWfForForward(), null);
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when cycle is not IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycle({ status: AdminCycleStatus.COMPLETED }));
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when step is not in the cycle', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycleForForward({ steps: [] }));
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'missing-step', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user is not assigned to the step', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycleForForward());
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'wrong-user', 'org-1', validDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when step is not PENDING', async () => {
      const { service, dataSource } = buildService();
      mockLookups(
        dataSource,
        makeWfForForward(),
        makeCycleForForward({ steps: [makeAdminStep({ status: AdminStepStatus.COMPLETED })] }),
      );
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when step is optional', async () => {
      const { service, dataSource } = buildService();
      mockLookups(
        dataSource,
        makeWfForForward(),
        makeCycleForForward({ steps: [makeAdminStep({ isOptional: true })] }),
      );
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when optionalReviewerId is not in the allowed list', async () => {
      const { service, dataSource } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycleForForward({ allowedOptionalReviewerIds: [] }));
      await expect(
        service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('inserts optional step, completes current step and emits kafka event on success', async () => {
      const { service, dataSource, stepRepo, kafkaProducer } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycleForForward());
      addQbToManager(dataSource);
      const insertedStep = makeAdminStep({ id: 'new-step-1', isOptional: true });
      dataSource._manager.save
        .mockResolvedValueOnce({ id: 'note-1' })
        .mockResolvedValueOnce(insertedStep);
      stepRepo.findOneOrFail.mockResolvedValue(insertedStep);

      const result = await service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', validDto);

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        WorkflowAdminStep, 'astep-1', expect.objectContaining({ status: AdminStepStatus.COMPLETED }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalled();
      expect(result.id).toBe(insertedStep.id);
    });

    it('saves attachments when dto.attachments is provided', async () => {
      const { service, dataSource, stepRepo } = buildService();
      mockLookups(dataSource, makeWfForForward(), makeCycleForForward());
      addQbToManager(dataSource);
      const insertedStep = makeAdminStep({ id: 'new-step-1', isOptional: true });
      dataSource._manager.save.mockResolvedValue(insertedStep);
      stepRepo.findOneOrFail.mockResolvedValue(insertedStep);

      await service.forwardStep('wf-1', 'cycle-1', 'astep-1', 'admin-user-1', 'org-1', {
        ...validDto,
        attachments: [{ storageKey: 'att-1', originalName: 'doc.pdf', mimeType: 'application/pdf' }],
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowAdminAttachment,
        expect.arrayContaining([expect.objectContaining({ storageKey: 'att-1' })]),
      );
    });
  });

  describe('addNote()', () => {
    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.addNote('wf-1', 'final-user-1', 'org-2', { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow is not AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));

      await expect(
        service.addNote('wf-1', 'final-user-1', 'org-1', { content: 'hi' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a designated final user', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );

      await expect(
        service.addNote('wf-1', 'not-final-user', 'org-1', { content: 'hi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when neither content nor attachments are provided, without locking the workflow', async () => {
      const { service, dataSource } = buildService();

      await expect(service.addNote('wf-1', 'final-user-1', 'org-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when content is only whitespace and no attachments', async () => {
      const { service } = buildService();

      await expect(
        service.addNote('wf-1', 'final-user-1', 'org-1', { content: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('saves a WorkflowNote with cycleId/adminStepId left null and records a NOTE_ADDED event', async () => {
      const { service, workflowRepo, dataSource, timelineService } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.addNote('wf-1', 'final-user-1', 'org-1', { content: '  Looks fine  ' });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ workflowId: 'wf-1', createdBy: 'final-user-1', content: 'Looks fine' }),
      );
      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.NOTE_ADDED }),
        expect.anything(),
      );
    });

    it('saves MANAGEMENT attachments linked to the note when both are provided', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);
      dataSource._manager.save.mockResolvedValueOnce({ id: 'note-1' });

      await service.addNote('wf-1', 'final-user-1', 'org-1', {
        content: 'See attached',
        attachments: [{ storageKey: 'k1', originalName: 'doc.pdf', mimeType: 'application/pdf' }],
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowAttachment,
        expect.arrayContaining([
          expect.objectContaining({
            storageKey: 'k1',
            attachmentType: AttachmentType.MANAGEMENT,
            noteId: 'note-1',
          }),
        ]),
      );
    });

    it('saves attachments with a null noteId when no content is provided', async () => {
      const { service, workflowRepo, dataSource, timelineService } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);
      workflowRepo.findOneOrFail.mockResolvedValue(wf);

      await service.addNote('wf-1', 'final-user-1', 'org-1', {
        attachments: [{ storageKey: 'k1', originalName: 'doc.pdf', mimeType: 'application/pdf' }],
      });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowAttachment,
        expect.arrayContaining([expect.objectContaining({ storageKey: 'k1', noteId: null })]),
      );
      const noteSaveCalls = (dataSource._manager.save as jest.Mock).mock.calls.filter(
        (c: [unknown]) => c[0] === WorkflowNote,
      );
      expect(noteSaveCalls).toHaveLength(0);
      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.ATTACHMENT_ADDED }),
        expect.anything(),
      );
    });
  });

  describe('closeWorkflow()', () => {
    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.closeWorkflow('wf-1', 'final-user-1', 'org-2', {}),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow is ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      await expect(service.closeWorkflow('wf-1', 'final-user-1', 'org-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when workflow is not AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.DRAFT }),
      );
      await expect(service.closeWorkflow('wf-1', 'final-user-1', 'org-1', {})).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a final user', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
      await expect(service.closeWorkflow('wf-1', 'not-final-user', 'org-1', {})).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to CLOSED and emits kafka events', async () => {
      const { service, dataSource, kafkaProducer } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.closeWorkflow('wf-1', 'final-user-1', 'org-1', { closingNotes: 'Done' });

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.CLOSED }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2); // CLOSED + NOTIFICATION_SEND
    });

    it('saves closing notes when provided', async () => {
      const { service, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.closeWorkflow('wf-1', 'final-user-1', 'org-1', { closingNotes: '  Closing note  ' });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ content: 'Closing note' }),
      );
    });

    it('does not save note when closingNotes is empty/whitespace', async () => {
      const { service, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.closeWorkflow('wf-1', 'final-user-1', 'org-1', { closingNotes: '   ' });

      const noteSaveCalls = (dataSource._manager.save as jest.Mock).mock.calls.filter(
        (c: [unknown]) => c[0] === WorkflowNote,
      );
      expect(noteSaveCalls).toHaveLength(0);
    });

    it('records WORKFLOW_CLOSED timeline event', async () => {
      const { service, dataSource, timelineService } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.closeWorkflow('wf-1', 'final-user-1', 'org-1', {});

      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.WORKFLOW_CLOSED }),
        expect.anything(),
      );
    });
  });

  describe('cancelWorkflow()', () => {
    it('scopes the locked workflow lookup to the caller org, so cross-org ids resolve as not found', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(null);

      await expect(
        service.cancelWorkflow('wf-1', 'final-user-1', 'org-2', { reason: 'No longer needed' }),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource._manager.findOne).toHaveBeenCalledWith(Workflow, {
        where: { id: 'wf-1', orgId: 'org-2' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('throws ConflictException when workflow is ADMIN_CYCLE_IN_PROGRESS', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS }),
      );
      await expect(
        service.cancelWorkflow('wf-1', 'final-user-1', 'org-1', { reason: 'No longer needed' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when workflow is not AVAILABLE_FOR_FINAL_USERS', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(makeWorkflow({ status: WorkflowStatus.DRAFT }));
      await expect(
        service.cancelWorkflow('wf-1', 'final-user-1', 'org-1', { reason: 'No longer needed' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not a final user', async () => {
      const { service, dataSource } = buildService();
      dataSource._manager.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS }),
      );
      await expect(
        service.cancelWorkflow('wf-1', 'not-final-user', 'org-1', { reason: 'No longer needed' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions workflow to CANCELLED and emits kafka events', async () => {
      const { service, dataSource, kafkaProducer } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.cancelWorkflow('wf-1', 'final-user-1', 'org-1', { reason: 'No longer needed' });

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ status: WorkflowStatus.CANCELLED, cancelledBy: 'final-user-1' }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalledTimes(2); // CANCELLED + NOTIFICATION_SEND
    });

    it('always saves the cancellation reason as a note', async () => {
      const { service, dataSource } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.cancelWorkflow('wf-1', 'final-user-1', 'org-1', { reason: 'No longer needed' });

      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowNote,
        expect.objectContaining({ content: 'No longer needed' }),
      );
    });

    it('records WORKFLOW_CANCELLED timeline event', async () => {
      const { service, dataSource, timelineService } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      dataSource._manager.findOne.mockResolvedValue(wf);

      await service.cancelWorkflow('wf-1', 'final-user-1', 'org-1', { reason: 'No longer needed' });

      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.WORKFLOW_CANCELLED }),
        expect.anything(),
      );
    });
  });
});
