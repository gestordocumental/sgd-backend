import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowApprovalService } from './workflow-approval.service';
import { WorkflowAdminCycleService } from './workflow-admin-cycle.service';
import { JwtPayload } from '../common/decorators/jwt-payload.decorator';
import { WorkflowStatus, AdminCycleStatus } from './entities/enums';
import { WorkflowResponseDto, AdminCycleResponseDto } from './dto/workflow-response.dto';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'user-1', companyId: 'org-1', ...overrides };
}

function makeWorkflowDto(overrides: Partial<WorkflowResponseDto> = {}): WorkflowResponseDto {
  return {
    id: 'wf-1',
    orgId: 'org-1',
    title: 'Test WF',
    status: WorkflowStatus.DRAFT,
    createdBy: 'user-1',
    approvers: [],
    attachments: [],
    approvalActions: [],
    ...overrides,
  } as unknown as WorkflowResponseDto;
}

function makeAdminCycleDto(): AdminCycleResponseDto {
  return {
    id: 'cycle-1',
    workflowId: 'wf-1',
    cycleNumber: 1,
    initiatedBy: 'user-1',
    status: AdminCycleStatus.IN_PROGRESS,
    steps: [],
  } as unknown as AdminCycleResponseDto;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeWorkflowsService(): jest.Mocked<WorkflowsService> {
  return {
    create: jest.fn().mockResolvedValue(makeWorkflowDto()),
    findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    findOne: jest.fn().mockResolvedValue(makeWorkflowDto()),
    update: jest.fn().mockResolvedValue(makeWorkflowDto()),
    remove: jest.fn().mockResolvedValue(undefined),
    getMyTasks: jest.fn().mockResolvedValue([makeWorkflowDto()]),
    getMyAvailable: jest.fn().mockResolvedValue([makeWorkflowDto()]),
    notifyNoFinalUsers: jest.fn().mockResolvedValue(undefined),
    getTimeline: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<WorkflowsService>;
}

function makeApprovalService(): jest.Mocked<WorkflowApprovalService> {
  return {
    startApproval: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockResolvedValue(undefined),
    reject: jest.fn().mockResolvedValue(undefined),
    resubmit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WorkflowApprovalService>;
}

function makeAdminCycleService(): jest.Mocked<WorkflowAdminCycleService> {
  return {
    createCycle: jest.fn().mockResolvedValue({ id: 'cycle-1', steps: [] }),
    completeStep: jest.fn().mockResolvedValue(undefined),
    finalizeCycle: jest.fn().mockResolvedValue({ id: 'cycle-1', steps: [] }),
    skipReviewCycle: jest.fn().mockResolvedValue(undefined),
    closeWorkflow: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WorkflowAdminCycleService>;
}

// ── Build controller ──────────────────────────────────────────────────────────

function buildController() {
  const workflowsService = makeWorkflowsService();
  const approvalService = makeApprovalService();
  const adminCycleService = makeAdminCycleService();
  const controller = new WorkflowsController(workflowsService, approvalService, adminCycleService);
  return { controller, workflowsService, approvalService, adminCycleService };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowsController', () => {
  describe('getMyTasks()', () => {
    it('delegates to workflowsService.getMyTasks', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();

      const result = await controller.getMyTasks(user);

      expect(workflowsService.getMyTasks).toHaveBeenCalledWith(user);
      expect(result).toHaveLength(1);
    });
  });

  describe('getMyAvailable()', () => {
    it('delegates to workflowsService.getMyAvailable', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();

      const result = await controller.getMyAvailable(user);

      expect(workflowsService.getMyAvailable).toHaveBeenCalledWith(user);
      expect(result).toHaveLength(1);
    });
  });

  describe('notifyNoFinalUsers()', () => {
    it('delegates to workflowsService.notifyNoFinalUsers', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();
      const dto = { typologyId: 'typ-1', typologyName: 'Tipo A', recipientIds: ['admin-1'] };

      await controller.notifyNoFinalUsers(dto, user);

      expect(workflowsService.notifyNoFinalUsers).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('create()', () => {
    it('delegates to workflowsService.create and returns the DTO', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();
      const dto = { title: 'WF', typologyId: 'typ-1', approvers: [], finalUserIds: ['u1'] } as never;

      const result = await controller.create(dto, user);

      expect(workflowsService.create).toHaveBeenCalledWith(dto, user);
      expect(result.id).toBe('wf-1');
    });
  });

  describe('findAll()', () => {
    it('returns paginated result from workflowsService.findAll', async () => {
      const { controller, workflowsService } = buildController();

      const result = await controller.findAll({}, makeUser());

      expect(workflowsService.findAll).toHaveBeenCalled();
      expect(result.total).toBe(0);
    });
  });

  describe('findOne()', () => {
    it('returns workflow DTO from workflowsService.findOne', async () => {
      const { controller, workflowsService } = buildController();

      const result = await controller.findOne('wf-1', makeUser());

      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', expect.any(Object));
      expect(result.id).toBe('wf-1');
    });
  });

  describe('update()', () => {
    it('delegates to workflowsService.update', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();
      const dto = { title: 'Updated' };

      const result = await controller.update('wf-1', dto, user);

      expect(workflowsService.update).toHaveBeenCalledWith('wf-1', dto, user);
      expect(result.id).toBe('wf-1');
    });
  });

  describe('remove()', () => {
    it('delegates to workflowsService.remove', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();

      await controller.remove('wf-1', user);

      expect(workflowsService.remove).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('startApproval()', () => {
    it('calls approvalService.startApproval then workflowsService.findOne', async () => {
      const { controller, approvalService, workflowsService } = buildController();
      const user = makeUser();

      await controller.startApproval('wf-1', user);

      expect(approvalService.startApproval).toHaveBeenCalledWith('wf-1', user.sub);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('approve()', () => {
    it('calls approvalService.approve then workflowsService.findOne', async () => {
      const { controller, approvalService, workflowsService } = buildController();
      const user = makeUser();
      const dto = { observations: 'Looks good' };

      await controller.approve('wf-1', dto, user);

      expect(approvalService.approve).toHaveBeenCalledWith('wf-1', user.sub, dto);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('reject()', () => {
    it('calls approvalService.reject then workflowsService.findOne', async () => {
      const { controller, approvalService, workflowsService } = buildController();
      const user = makeUser();
      const dto = { observations: 'Needs revisions' };

      await controller.reject('wf-1', dto, user);

      expect(approvalService.reject).toHaveBeenCalledWith('wf-1', user.sub, dto);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('resubmit()', () => {
    it('calls approvalService.resubmit then workflowsService.findOne', async () => {
      const { controller, approvalService, workflowsService } = buildController();
      const user = makeUser();
      const dto = { observations: 'Fixed' };

      await controller.resubmit('wf-1', dto, user);

      expect(approvalService.resubmit).toHaveBeenCalledWith('wf-1', user.sub, dto);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('createAdminCycle()', () => {
    it('calls adminCycleService.createCycle and returns mapped AdminCycleResponseDto', async () => {
      const { controller, adminCycleService } = buildController();
      const user = makeUser();
      const dto = { steps: [{ userId: 'admin-1', stepOrder: 1 }] };

      adminCycleService.createCycle.mockResolvedValue({
        id: 'cycle-1',
        workflowId: 'wf-1',
        cycleNumber: 1,
        initiatedBy: 'user-1',
        status: AdminCycleStatus.IN_PROGRESS,
        steps: [],
      } as never);

      const result = await controller.createAdminCycle('wf-1', dto, user);

      expect(adminCycleService.createCycle).toHaveBeenCalledWith('wf-1', user.sub, dto);
      expect(result).toBeDefined();
    });
  });

  describe('completeAdminStep()', () => {
    it('delegates to adminCycleService.completeStep', async () => {
      const { controller, adminCycleService } = buildController();
      const user = makeUser();
      const dto = { notes: 'Done' };

      await controller.completeAdminStep('wf-1', 'cycle-1', 'step-1', dto, user);

      expect(adminCycleService.completeStep).toHaveBeenCalledWith(
        'wf-1', 'cycle-1', 'step-1', user.sub, dto,
      );
    });
  });

  describe('finalizeAdminCycle()', () => {
    it('calls adminCycleService.finalizeCycle and returns mapped DTO', async () => {
      const { controller, adminCycleService } = buildController();
      const user = makeUser();

      adminCycleService.finalizeCycle.mockResolvedValue({
        id: 'cycle-1',
        workflowId: 'wf-1',
        cycleNumber: 1,
        initiatedBy: 'user-1',
        status: AdminCycleStatus.COMPLETED,
        steps: [],
      } as never);

      const result = await controller.finalizeAdminCycle('wf-1', 'cycle-1', user);

      expect(adminCycleService.finalizeCycle).toHaveBeenCalledWith('wf-1', 'cycle-1', user.sub);
      expect(result).toBeDefined();
    });
  });

  describe('skipReviewCycle()', () => {
    it('calls adminCycleService.skipReviewCycle then workflowsService.findOne', async () => {
      const { controller, adminCycleService, workflowsService } = buildController();
      const user = makeUser();

      await controller.skipReviewCycle('wf-1', user);

      expect(adminCycleService.skipReviewCycle).toHaveBeenCalledWith('wf-1', user.sub);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('close()', () => {
    it('calls adminCycleService.closeWorkflow then workflowsService.findOne', async () => {
      const { controller, adminCycleService, workflowsService } = buildController();
      const user = makeUser();
      const dto = { closingNotes: 'All done' };

      await controller.close('wf-1', dto, user);

      expect(adminCycleService.closeWorkflow).toHaveBeenCalledWith('wf-1', user.sub, dto);
      expect(workflowsService.findOne).toHaveBeenCalledWith('wf-1', user);
    });
  });

  describe('getTimeline()', () => {
    it('delegates to workflowsService.getTimeline', async () => {
      const { controller, workflowsService } = buildController();
      const user = makeUser();

      const result = await controller.getTimeline('wf-1', user);

      expect(workflowsService.getTimeline).toHaveBeenCalledWith('wf-1', user);
      expect(result).toEqual([]);
    });
  });
});
