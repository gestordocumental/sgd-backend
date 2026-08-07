import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { WorkflowsService } from './workflows.service';
import { Workflow } from './entities/workflow.entity';
import { WorkflowApprovalStep } from './entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './entities/workflow-approval-action.entity';
import { WorkflowAttachment } from './entities/workflow-attachment.entity';
import { WorkflowTimeline } from './entities/workflow-timeline.entity';
import { WorkflowAdminCycle } from './entities/workflow-admin-cycle.entity';
import { WorkflowStatus, ApprovalStepStatus, AttachmentType, TimelineEventType } from './entities/enums';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { AppLogger, KafkaProducerService, JwtPayload } from '@sgd/common';
import { DocumentClientService } from '../common/clients/document-client.service';
import { UserClientService } from '../common/clients/user-client.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeCreateDto(overrides: Partial<CreateWorkflowDto> = {}): CreateWorkflowDto {
  return {
    title: 'Test',
    typologyId: 'typ-1',
    approvers: [{ userId: 'approver-1', stepOrder: 1 }],
    finalUserIds: ['final-user-1'],
    ...overrides,
  } as CreateWorkflowDto;
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'user-1', companyId: 'org-1', ...overrides };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    orgId: 'org-1',
    title: 'Test Workflow',
    status: WorkflowStatus.DRAFT,
    createdBy: 'user-1',
    mainDocumentValidated: true,
    approvalSteps: [],
    attachments: [],
    finalUserIds: null,
    activeAdminCycleId: null,
    ...overrides,
  } as unknown as Workflow;
}

function makeStep(overrides: Partial<WorkflowApprovalStep> = {}): WorkflowApprovalStep {
  return {
    id: 'step-1',
    workflowId: 'wf-1',
    userId: 'approver-1',
    stepOrder: 1,
    status: ApprovalStepStatus.WAITING,
    ...overrides,
  } as WorkflowApprovalStep;
}

// ── Repository / service mocks ─────────────────────────────────────────────────

function makeRepo<T extends ObjectLiteral>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    softDelete: jest.fn(),
    createQueryBuilder: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<Repository<T>>;
}

function makeQb(results: { data: Workflow[]; total: number }) {
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([results.data, results.total]),
    getMany: jest.fn().mockResolvedValue(results.data),
  } as unknown as jest.Mocked<SelectQueryBuilder<Workflow>>;
  return qb;
}

function makeDataSource() {
  const manager = {
    create: jest.fn((_Entity: unknown, data: unknown) => data as object),
    save: jest.fn().mockImplementation((_Entity: unknown, data: unknown) => Promise.resolve({ id: 'new-id', ...(data as object) })),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
    }),
  };

  return {
    transaction: jest.fn().mockImplementation(async (fn: (m: typeof manager) => Promise<void>) => {
      await fn(manager);
    }),
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
    }),
    query: jest.fn().mockResolvedValue([]),
    _manager: manager,
  } as unknown as jest.Mocked<DataSource> & { _manager: typeof manager; query: jest.Mock };
}

// ── Build service ─────────────────────────────────────────────────────────────

function buildService() {
  const workflowRepo = makeRepo<Workflow>();
  const stepRepo = makeRepo<WorkflowApprovalStep>();
  const actionRepo = makeRepo<WorkflowApprovalAction>();
  const attachmentRepo = makeRepo<WorkflowAttachment>();
  const timelineRepo = makeRepo<WorkflowTimeline>();
  const dataSource = makeDataSource();

  const timelineService: jest.Mocked<WorkflowTimelineService> = {
    record: jest.fn().mockResolvedValue({ id: 'tl-1' }),
    getTimeline: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowTimelineService>;

  const kafkaProducer: jest.Mocked<KafkaProducerService> = {
    emitSafe: jest.fn(),
  } as unknown as jest.Mocked<KafkaProducerService>;

  const documentClientService: jest.Mocked<DocumentClientService> = {
    getTypologyInfo: jest.fn().mockResolvedValue({
      codigo: 'TYP-001',
      version: 1,
      nombre: 'Tipología Test',
    }),
  } as unknown as jest.Mocked<DocumentClientService>;

  const userClientService: jest.Mocked<UserClientService> = {
    getUsersByIds: jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<UserClientService>;

  const logger: jest.Mocked<AppLogger> = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;

  const service = new WorkflowsService(
    workflowRepo,
    stepRepo,
    actionRepo,
    attachmentRepo,
    timelineRepo,
    dataSource,
    timelineService,
    kafkaProducer,
    documentClientService,
    userClientService,
    logger,
  );

  return { service, workflowRepo, stepRepo, actionRepo, attachmentRepo, timelineRepo, dataSource, timelineService, kafkaProducer, documentClientService, userClientService };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowsService', () => {
  describe('create()', () => {
    it('throws BadRequestException when approver stepOrders are not consecutive from 1', async () => {
      const { service } = buildService();
      const user = makeUser();
      await expect(
        service.create(makeCreateDto({ approvers: [{ userId: 'u1', stepOrder: 2 }] }), user),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when approver stepOrders have duplicates', async () => {
      const { service } = buildService();
      const user = makeUser();
      await expect(
        service.create(
          makeCreateDto({
            approvers: [
              { userId: 'u1', stepOrder: 1 },
              { userId: 'u2', stepOrder: 1 },
            ],
          }),
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a workflow and records a timeline event on success', async () => {
      const { service, workflowRepo, actionRepo, dataSource, timelineService, kafkaProducer } =
        buildService();
      const user = makeUser();

      const savedWorkflow = makeWorkflow({ approvalSteps: [makeStep()] });
      workflowRepo.findOne.mockResolvedValue(savedWorkflow);
      actionRepo.find.mockResolvedValue([]);
      dataSource._manager.save.mockImplementation((_Entity: unknown, data: unknown) =>
        Promise.resolve({ id: 'wf-new', ...(data as object) }),
      );

      await service.create(makeCreateDto({ title: 'New Workflow' }), user);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(timelineService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: TimelineEventType.WORKFLOW_CREATED }),
      );
      expect(kafkaProducer.emitSafe).toHaveBeenCalled();
    });

    it('creates attachments when provided', async () => {
      const { service, workflowRepo, actionRepo, dataSource } = buildService();
      const user = makeUser();
      const savedWorkflow = makeWorkflow({ approvalSteps: [makeStep()] });
      workflowRepo.findOne.mockResolvedValue(savedWorkflow);
      actionRepo.find.mockResolvedValue([]);

      await service.create(
        makeCreateDto({
          title: 'New Workflow',
          attachments: [
            { storageKey: 'key-1', originalName: 'file.pdf', mimeType: 'application/pdf' },
          ],
        }),
        user,
      );

      // manager.save should be called for workflow + steps + attachments
      expect(dataSource._manager.save).toHaveBeenCalledTimes(3);
    });
  });

  describe('findAll()', () => {
    it('returns paginated workflows for the org', async () => {
      const { service, workflowRepo } = buildService();
      const wf = makeWorkflow();
      const qb = makeQb({ data: [wf], total: 1 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.findAll({ page: 1, limit: 10 }, makeUser());

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('uses default page=1 and limit=20 when not specified', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.findAll({}, makeUser());

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('applies status filter when provided', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.findAll({ status: WorkflowStatus.DRAFT }, makeUser());

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        expect.objectContaining({ status: WorkflowStatus.DRAFT }),
      );
    });
  });

  describe('findOne()', () => {
    it('returns the workflow DTO when found', async () => {
      const { service, workflowRepo, actionRepo, dataSource } = buildService();
      const wf = makeWorkflow({ approvalSteps: [makeStep()], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([]),
      });

      const result = await service.findOne('wf-1', makeUser());
      expect(result).toBeDefined();
    });

    it('throws NotFoundException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('wf-missing', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('resolves participant names for creator, approval steps and final users — not gated by USERS:READ', async () => {
      // Regression: DetailWorkflowDialog showed "Usuario desconocido" for every
      // approver/final user unless the viewer's role also had USERS:READ (an
      // unrelated permission). Names must come resolved from the backend instead.
      const { service, workflowRepo, actionRepo, dataSource, userClientService } = buildService();
      const wf = makeWorkflow({
        createdBy: 'creator-1',
        finalUserIds: ['final-1'],
        approvalSteps: [makeStep({ userId: 'approver-1' })],
        attachments: [],
      });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });
      userClientService.getUsersByIds.mockResolvedValue(
        new Map([
          ['creator-1', { id: 'creator-1', displayName: 'Carla Creator' }],
          ['approver-1', { id: 'approver-1', displayName: 'Ana Approver' }],
          ['final-1', { id: 'final-1', displayName: 'Felipe Final' }],
        ]),
      );

      const result = await service.findOne('wf-1', makeUser());

      expect(userClientService.getUsersByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['creator-1', 'approver-1', 'final-1']),
      );
      expect(result.participantNames).toEqual({
        'creator-1':  'Carla Creator',
        'approver-1': 'Ana Approver',
        'final-1':    'Felipe Final',
      });
    });

    it('resolves participant names for allowedOptionalReviewerIds on admin cycles — used by ForwardStepDialog\'s selector', async () => {
      // Regression: the optional-reviewer selector in ForwardStepDialog showed
      // the raw user ID instead of a name for a viewer without USERS:READ,
      // because allowedOptionalReviewerIds was never collected here.
      const { service, workflowRepo, actionRepo, dataSource, userClientService } = buildService();
      const wf = makeWorkflow({
        createdBy: 'creator-1',
        approvalSteps: [],
        attachments: [],
        activeAdminCycleId: 'cycle-1',
      });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      const cycle = {
        id: 'cycle-1',
        workflowId: 'wf-1',
        cycleNumber: 1,
        initiatedBy: 'creator-1',
        steps: [],
        allowedOptionalReviewerIds: ['optional-1', 'optional-2'],
      };
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([cycle]) });
      userClientService.getUsersByIds.mockResolvedValue(
        new Map([
          ['creator-1', { id: 'creator-1', displayName: 'Carla Creator' }],
          ['optional-1', { id: 'optional-1', displayName: 'Oscar One' }],
          ['optional-2', { id: 'optional-2', displayName: 'Olivia Two' }],
        ]),
      );

      const result = await service.findOne('wf-1', makeUser());

      expect(userClientService.getUsersByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['creator-1', 'optional-1', 'optional-2']),
      );
      expect(result.participantNames).toEqual({
        'creator-1':  'Carla Creator',
        'optional-1': 'Oscar One',
        'optional-2': 'Olivia Two',
      });
    });

    it('omits a participant with displayName: null from participantNames, instead of leaking a null or falling back to email', async () => {
      // Regression: batch-display-names returns displayName: null (never
      // email) for a user with no first/last name set. That must not end up
      // as a null value in participantNames (Record<string, string>) — the
      // frontend's "unknown user" fallback handles a missing key already.
      const { service, workflowRepo, actionRepo, dataSource, userClientService } = buildService();
      const wf = makeWorkflow({ createdBy: 'creator-1', approvalSteps: [], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });
      userClientService.getUsersByIds.mockResolvedValue(
        new Map([['creator-1', { id: 'creator-1', displayName: null }]]),
      );

      const result = await service.findOne('wf-1', makeUser());

      expect(result.participantNames).toEqual({});
    });

    it('omits a participant from the map instead of failing when user-service could not resolve it', async () => {
      const { service, workflowRepo, actionRepo, dataSource, userClientService } = buildService();
      const wf = makeWorkflow({ createdBy: 'creator-1', approvalSteps: [], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });
      userClientService.getUsersByIds.mockResolvedValue(new Map()); // best-effort failure

      const result = await service.findOne('wf-1', makeUser());

      expect(result.participantNames).toEqual({});
    });
  });

  describe('update()', () => {
    it('throws NotFoundException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.update('wf-1', { title: 'new' }, makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when workflow is not DRAFT', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.PENDING_APPROVAL }),
      );

      await expect(service.update('wf-1', { title: 'new' }, makeUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ForbiddenException when user is not creator and not superAdmin', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow({ createdBy: 'other-user' }));

      await expect(
        service.update('wf-1', { title: 'new' }, makeUser({ sub: 'not-creator' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows superAdmin to update a workflow they did not create', async () => {
      const { service, workflowRepo, actionRepo, dataSource } = buildService();
      workflowRepo.findOne
        .mockResolvedValueOnce(makeWorkflow({ createdBy: 'other-user' })) // update load
        .mockResolvedValueOnce(makeWorkflow({ approvalSteps: [], attachments: [] })); // findOneOrFail
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });

      await expect(
        service.update('wf-1', { title: 'new' }, makeUser({ isSuperAdmin: true })),
      ).resolves.toBeDefined();
    });

    it('throws BadRequestException for invalid approver step orders in update', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());

      await expect(
        service.update(
          'wf-1',
          { approvers: [{ userId: 'u1', stepOrder: 2 }] },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates title and description successfully', async () => {
      const { service, workflowRepo, dataSource, actionRepo } = buildService();
      workflowRepo.findOne
        .mockResolvedValueOnce(makeWorkflow())
        .mockResolvedValueOnce(makeWorkflow({ approvalSteps: [], attachments: [] }));
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });

      const result = await service.update('wf-1', { title: 'Updated', description: 'Desc' }, makeUser());
      expect(result).toBeDefined();
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('throws NotFoundException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('wf-1', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when workflow is in PENDING_APPROVAL and user is not superAdmin', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.PENDING_APPROVAL }),
      );

      await expect(service.remove('wf-1', makeUser())).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when user is not the creator', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow({ createdBy: 'other-user' }));

      await expect(service.remove('wf-1', makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('soft-deletes a DRAFT workflow created by the user', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      workflowRepo.findOne.mockResolvedValue(makeWorkflow());
      workflowRepo.softDelete.mockResolvedValue(undefined as never);

      await service.remove('wf-1', makeUser());

      expect(workflowRepo.softDelete).toHaveBeenCalledWith('wf-1');
      expect(kafkaProducer.emitSafe).toHaveBeenCalled();
    });

    it('allows superAdmin to delete a non-DRAFT workflow', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      workflowRepo.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.PENDING_APPROVAL, createdBy: 'other-user' }),
      );
      workflowRepo.softDelete.mockResolvedValue(undefined as never);

      await service.remove('wf-1', makeUser({ isSuperAdmin: true }));

      expect(workflowRepo.softDelete).toHaveBeenCalled();
    });

    it('allows removing a CANCELLED workflow', async () => {
      const { service, workflowRepo, kafkaProducer } = buildService();
      workflowRepo.findOne.mockResolvedValue(
        makeWorkflow({ status: WorkflowStatus.CANCELLED }),
      );
      workflowRepo.softDelete.mockResolvedValue(undefined as never);

      await service.remove('wf-1', makeUser());
      expect(workflowRepo.softDelete).toHaveBeenCalled();
    });
  });

  describe('getMyTasks()', () => {
    it('returns workflows where current assigned user is the caller', async () => {
      const { service, workflowRepo } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.PENDING_APPROVAL });
      const qb = makeQb({ data: [wf], total: 1 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getMyTasks(makeUser());
      expect(result).toHaveLength(1);
    });
  });

  describe('getMyAvailable()', () => {
    it('returns workflows where user is in finalUserIds', async () => {
      const { service, workflowRepo } = buildService();
      const wf = makeWorkflow({ status: WorkflowStatus.AVAILABLE_FOR_FINAL_USERS });
      const qb = makeQb({ data: [wf], total: 1 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getMyAvailable(makeUser());
      expect(result).toHaveLength(1);
    });

    it('includes CLOSED in every status filter — final user, past reviewer, creator and approver — so closed workflows the user participated in remain visible', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getMyAvailable(makeUser());

      const statusParams = (qb.andWhere as jest.Mock).mock.calls
        .map(([, params]: [string, Record<string, unknown> | undefined]) => params)
        .filter((params): params is Record<string, unknown> => params !== undefined);

      expect(statusParams).toEqual(
        expect.arrayContaining([
          // finalUserWorkflows
          expect.objectContaining({
            statuses: expect.arrayContaining([WorkflowStatus.CLOSED]),
          }),
          // pastAdminReviewerWorkflows
          expect.objectContaining({
            visibleStatuses: expect.arrayContaining([
              WorkflowStatus.REJECTED,
              WorkflowStatus.CLOSED,
            ]),
          }),
          // createdByUserWorkflows
          expect.objectContaining({
            creatorStatuses: expect.arrayContaining([WorkflowStatus.CLOSED]),
          }),
          // approverWorkflows
          expect.objectContaining({
            approverStatuses: expect.arrayContaining([WorkflowStatus.CLOSED]),
          }),
        ]),
      );
    });

    it('surfaces mandatory (non-optional) admin-cycle reviewers too, not just optional ones', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getMyAvailable(makeUser());

      const rawSqlCalls = (qb.andWhere as jest.Mock).mock.calls
        .map(([sql]: [unknown]) => sql)
        .filter((sql: unknown): sql is string => typeof sql === 'string');
      // Category 4's EXISTS clause (past admin-cycle reviewers, any outcome) is
      // the one referencing workflow_admin_steps without a PENDING step filter —
      // category 2 (active optional-reviewer invitations) also joins that table
      // but requires PENDING + is_optional, so this distinguishes the two.
      const pastReviewerSql = rawSqlCalls.find(
        (sql) => sql.includes('workflow_admin_steps s') && !sql.includes('PENDING'),
      );
      expect(pastReviewerSql).toBeDefined();
      expect(pastReviewerSql).not.toContain('is_optional');
    });
  });

  describe('notifyNoFinalUsers()', () => {
    it('emits NOTIFICATION_SEND kafka event', async () => {
      const { service, kafkaProducer } = buildService();

      await service.notifyNoFinalUsers(
        { typologyId: 'typ-1', typologyName: 'Tipo A', recipientIds: ['admin-1'] },
        makeUser(),
      );

      expect(kafkaProducer.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'NO_FINAL_USER_ALERT' }),
      );
    });
  });

  describe('getTimeline()', () => {
    it('throws NotFoundException when workflow not found', async () => {
      const { service, workflowRepo } = buildService();
      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.getTimeline('wf-1', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('returns mapped timeline events', async () => {
      const { service, workflowRepo, timelineService } = buildService();
      const wf = makeWorkflow({ approvalSteps: [], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      timelineService.getTimeline.mockResolvedValue([
        {
          id: 'tl-1',
          workflowId: 'wf-1',
          eventType: TimelineEventType.WORKFLOW_CREATED,
          actorId: 'user-1',
          description: 'Created',
          createdAt: new Date(),
        } as WorkflowTimeline,
      ]);

      const result = await service.getTimeline('wf-1', makeUser());
      expect(result).toHaveLength(1);
    });

    it('validates access without loading actions/admin-cycles or resolving participant names — that work is wasted since the DTO is discarded here', async () => {
      // Regression: getTimeline used to call the full findOneOrFail (actions +
      // admin cycles + resolveParticipantNames' own getUsersByIds batch call)
      // purely to check access, then threw that whole DTO away. That meant two
      // separate user-service round-trips per request. It must now call the
      // lightweight, access-only path instead.
      const { service, workflowRepo, timelineService, actionRepo, dataSource, userClientService } =
        buildService();
      const wf = makeWorkflow({ approvalSteps: [], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      timelineService.getTimeline.mockResolvedValue([
        {
          id: 'tl-1',
          workflowId: 'wf-1',
          eventType: TimelineEventType.WORKFLOW_CREATED,
          actorId: 'user-1',
          description: 'Created',
          createdAt: new Date(),
        } as WorkflowTimeline,
      ]);

      await service.getTimeline('wf-1', makeUser());

      expect(actionRepo.find).not.toHaveBeenCalled();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(userClientService.getUsersByIds).toHaveBeenCalledTimes(1);
    });

    it('resolves actor names via user-service so the timeline does not depend on the viewer holding USERS:READ', async () => {
      const { service, workflowRepo, timelineService, userClientService } = buildService();
      const wf = makeWorkflow({ approvalSteps: [], attachments: [] });
      workflowRepo.findOne.mockResolvedValue(wf);
      timelineService.getTimeline.mockResolvedValue([
        {
          id: 'tl-1',
          workflowId: 'wf-1',
          eventType: TimelineEventType.WORKFLOW_CREATED,
          actorId: 'user-1',
          description: 'Created',
          createdAt: new Date(),
        },
        {
          id: 'tl-2',
          workflowId: 'wf-1',
          eventType: TimelineEventType.STEP_APPROVED,
          actorId: 'user-2',
          description: 'Approved',
          createdAt: new Date(),
        },
        // Duplicate actor — must be deduped before calling user-service.
        {
          id: 'tl-3',
          workflowId: 'wf-1',
          eventType: TimelineEventType.STEP_APPROVED,
          actorId: 'user-1',
          description: 'Approved again',
          createdAt: new Date(),
        },
      ] as WorkflowTimeline[]);
      userClientService.getUsersByIds.mockResolvedValue(
        new Map([['user-1', { id: 'user-1', displayName: 'Ada Lovelace' }]]),
      );

      const result = await service.getTimeline('wf-1', makeUser());

      expect(userClientService.getUsersByIds).toHaveBeenCalledWith(['user-1', 'user-2']);
      expect(result[0].actorName).toBe('Ada Lovelace');
      expect(result[2].actorName).toBe('Ada Lovelace');
      // user-2 wasn't in the resolved map (e.g. user-service couldn't be reached
      // for that id) — falls back to null instead of throwing or omitting the event.
      expect(result[1].actorName).toBeNull();
    });
  });

  describe('validateApproverStepOrders (via create)', () => {
    const cases: Array<{ label: string; approvers: { userId: string; stepOrder: number }[] }> = [
      { label: 'single approver', approvers: [{ userId: 'u1', stepOrder: 1 }] },
      {
        label: 'two consecutive approvers',
        approvers: [
          { userId: 'u1', stepOrder: 1 },
          { userId: 'u2', stepOrder: 2 },
        ],
      },
      {
        label: 'three consecutive approvers',
        approvers: [
          { userId: 'u1', stepOrder: 1 },
          { userId: 'u2', stepOrder: 2 },
          { userId: 'u3', stepOrder: 3 },
        ],
      },
    ];

    for (const { label, approvers } of cases) {
      it(`does not throw for valid step orders: ${label}`, async () => {
        const { service, workflowRepo, dataSource, actionRepo } = buildService();
        const wf = makeWorkflow({ approvalSteps: [makeStep()], attachments: [] });
        workflowRepo.findOne.mockResolvedValue(wf);
        actionRepo.find.mockResolvedValue([]);
        dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });

        await expect(
          service.create(makeCreateDto({ approvers }), makeUser()),
        ).resolves.toBeDefined();
      });
    }

    it('throws for gap in step orders (1, 3)', async () => {
      const { service } = buildService();
      await expect(
        service.create(
          makeCreateDto({
            approvers: [
              { userId: 'u1', stepOrder: 1 },
              { userId: 'u2', stepOrder: 3 },
            ],
          }),
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws for starting at 0 instead of 1', async () => {
      const { service } = buildService();
      await expect(
        service.create(
          makeCreateDto({ approvers: [{ userId: 'u1', stepOrder: 0 }] }),
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll() — search filter', () => {
    it('applies ILIKE filter when search is a non-empty string', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.findAll({ search: 'hello world' }, makeUser());

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.objectContaining({ term: '%hello world%' }),
      );
    });

    it('skips ILIKE filter when search trims to empty', async () => {
      const { service, workflowRepo } = buildService();
      const qb = makeQb({ data: [], total: 0 });
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.findAll({ search: '   ' }, makeUser());

      const ilikeCalls = (qb.andWhere as jest.Mock).mock.calls.filter(
        (c: [string]) => typeof c[0] === 'string' && c[0].includes('ILIKE'),
      );
      expect(ilikeCalls).toHaveLength(0);
    });
  });

  describe('update() — field-specific branches', () => {
    function prepareUpdate(overrides: Partial<Workflow> = {}) {
      const { service, workflowRepo, actionRepo, dataSource } = buildService();
      workflowRepo.findOne
        .mockResolvedValueOnce(makeWorkflow(overrides))
        .mockResolvedValueOnce(makeWorkflow({ approvalSteps: [], attachments: [] }));
      actionRepo.find.mockResolvedValue([]);
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) });
      return { service, dataSource };
    }

    it('updates mainDocument fields when dto.mainDocument is provided', async () => {
      const { service, dataSource } = prepareUpdate();

      await service.update(
        'wf-1',
        { mainDocument: { storageKey: 'sk-1', originalName: 'file.pdf', mimeType: 'application/pdf' } },
        makeUser(),
      );

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ mainDocumentId: 'sk-1', mainDocumentValidated: true }),
      );
    });

    it('updates finalUserIds when dto.finalUserIds is provided', async () => {
      const { service, dataSource } = prepareUpdate();

      await service.update('wf-1', { finalUserIds: ['ua', 'ub'] }, makeUser());

      expect(dataSource._manager.update).toHaveBeenCalledWith(
        Workflow,
        'wf-1',
        expect.objectContaining({ finalUserIds: ['ua', 'ub'] }),
      );
    });

    it('replaces approval steps when dto.approvers is provided', async () => {
      const { service, dataSource } = prepareUpdate();

      await service.update('wf-1', { approvers: [{ userId: 'u-new', stepOrder: 1 }] }, makeUser());

      expect(dataSource._manager.delete).toHaveBeenCalledWith(WorkflowApprovalStep, { workflowId: 'wf-1' });
      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowApprovalStep,
        expect.arrayContaining([expect.objectContaining({ userId: 'u-new', stepOrder: 1 })]),
      );
    });

    it('replaces attachments when dto.attachments has items', async () => {
      const { service, dataSource } = prepareUpdate();

      await service.update(
        'wf-1',
        { attachments: [{ storageKey: 'att-1', originalName: 'doc.pdf', mimeType: 'application/pdf' }] },
        makeUser(),
      );

      expect(dataSource._manager.delete).toHaveBeenCalledWith(WorkflowAttachment, {
        workflowId: 'wf-1',
        attachmentType: AttachmentType.SUPPORTING,
      });
      expect(dataSource._manager.save).toHaveBeenCalledWith(
        WorkflowAttachment,
        expect.arrayContaining([expect.objectContaining({ storageKey: 'att-1' })]),
      );
    });

    it('deletes all attachments when dto.attachments is an empty array', async () => {
      const { service, dataSource } = prepareUpdate();

      await service.update('wf-1', { attachments: [] }, makeUser());

      expect(dataSource._manager.delete).toHaveBeenCalledWith(WorkflowAttachment, {
        workflowId: 'wf-1',
        attachmentType: AttachmentType.SUPPORTING,
      });
    });
  });

  describe('findOne() — activeAdminCycleId branch', () => {
    it('resolves the active cycle from allAdminCycles when activeAdminCycleId is set', async () => {
      const { service, workflowRepo, actionRepo, dataSource } = buildService();
      const wf = makeWorkflow({ approvalSteps: [], attachments: [], activeAdminCycleId: 'cycle-1' });
      workflowRepo.findOne.mockResolvedValue(wf);
      actionRepo.find.mockResolvedValue([]);
      const cycle = { id: 'cycle-1', workflowId: 'wf-1', cycleNumber: 1, steps: [] };
      dataSource.getRepository = jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([cycle]) });

      const result = await service.findOne('wf-1', makeUser());
      expect(result).toBeDefined();
    });
  });

  describe('getStats()', () => {
    function buildStatsService() {
      const { service, workflowRepo, dataSource } = buildService();
      (workflowRepo as unknown as { count: jest.Mock }).count = jest.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3);
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { status: 'DRAFT', count: '7' },
          { status: 'PENDING_APPROVAL', count: '3' },
        ]),
      });
      (dataSource as unknown as { query: jest.Mock }).query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total_bytes: '2048', total_files: '4' }]);
      return { service, workflowRepo, dataSource };
    }

    it('returns totalWorkflows, statusCounts, myPendingTasks, weeklyTrend and storage', async () => {
      const { service } = buildStatsService();

      const result = await service.getStats('org-1', 'user-1');

      expect(result.totalWorkflows).toBe(10);
      expect(result.myPendingTasks).toBe(3);
      expect(result.statusCounts).toEqual({ DRAFT: 7, PENDING_APPROVAL: 3 });
      expect(result.weeklyTrend).toHaveLength(8);
      expect(result.storageTotalBytes).toBe(2048);
      expect(result.totalAttachments).toBe(4);
    });

    it('returns 0 for myPendingTasks when no userId is provided', async () => {
      const { service, workflowRepo, dataSource } = buildService();
      (workflowRepo as unknown as { count: jest.Mock }).count = jest.fn().mockResolvedValueOnce(5);
      workflowRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      (dataSource as unknown as { query: jest.Mock }).query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total_bytes: '0', total_files: '0' }]);

      const result = await service.getStats('org-1');
      expect(result.myPendingTasks).toBe(0);
    });
  });

  describe('getStoragePerOrg()', () => {
    it('returns storage totals per org', async () => {
      const { service, dataSource } = buildService();
      (dataSource as unknown as { query: jest.Mock }).query = jest.fn().mockResolvedValue([
        { org_id: 'org-1', total_bytes: '512', total_files: '2' },
        { org_id: 'org-2', total_bytes: '1024', total_files: '3' },
      ]);

      const result = await service.getStoragePerOrg();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ orgId: 'org-1', storageTotalBytes: 512, totalAttachments: 2 });
      expect(result[1]).toEqual({ orgId: 'org-2', storageTotalBytes: 1024, totalAttachments: 3 });
    });

    it('returns empty array when there is no storage data', async () => {
      const { service, dataSource } = buildService();
      (dataSource as unknown as { query: jest.Mock }).query = jest.fn().mockResolvedValue([]);

      const result = await service.getStoragePerOrg();
      expect(result).toHaveLength(0);
    });
  });
});
