import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { EmailService } from './email/email.service';
import { UserClientService } from './user-client/user-client.service';
import { AppLogger } from '@sgd/common';
import { ListNotificationsDto } from './dto/list-notifications.dto';

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  const n = new Notification();
  n.id           = 'notif-1';
  n.userId       = 'user-1';
  n.type         = 'WORKFLOW_APPROVED';
  n.title        = 'Workflow aprobado';
  n.message      = 'Tu workflow fue aprobado';
  n.workflowId   = null;
  n.workflowTitle = null;
  n.read         = false;
  n.readAt       = null;
  n.metadata     = null;
  n.createdAt    = new Date('2024-01-01T00:00:00Z');
  return Object.assign(n, overrides);
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let qb: any;
  let repo: any;
  let emailService: jest.Mocked<Pick<EmailService, 'sendNotification' | 'sendInvitation'>>;
  let userClient: jest.Mocked<Pick<UserClientService, 'getUsersByIds'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'error'>>;

  beforeEach(() => {
    qb = {
      where:          jest.fn().mockReturnThis(),
      orderBy:        jest.fn().mockReturnThis(),
      skip:           jest.fn().mockReturnThis(),
      take:           jest.fn().mockReturnThis(),
      andWhere:       jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      update:         jest.fn().mockReturnThis(),
      set:            jest.fn().mockReturnThis(),
      execute:        jest.fn().mockResolvedValue({ affected: 0 }),
    };

    repo = {
      create:             jest.fn().mockImplementation((data) => Object.assign(new Notification(), data)),
      save:               jest.fn().mockResolvedValue([]),
      findOne:            jest.fn().mockResolvedValue(null),
      count:              jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    emailService = { sendNotification: jest.fn().mockResolvedValue(undefined), sendInvitation: jest.fn() };
    userClient   = { getUsersByIds: jest.fn().mockResolvedValue(new Map()) };
    logger       = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const orgClient = { getOrgName: jest.fn().mockResolvedValue(null) };

    const sseService = { emit: jest.fn() };

    service = new NotificationsService(
      repo,
      emailService as any,
      userClient as any,
      orgClient as any,
      sseService as any,
      logger as any,
    );
  });

  // ─── dispatch ─────────────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('saves internal notifications and sends email when user has email', async () => {
      const userId = 'user-uuid-1';
      userClient.getUsersByIds.mockResolvedValue(
        new Map([[userId, { id: userId, email: 'user@test.com', fullName: 'Test User' }]]),
      );

      await service.dispatch({
        type: 'WORKFLOW_APPROVED',
        recipientUserIds: [userId],
        message: 'Aprobado',
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(emailService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@test.com', type: 'WORKFLOW_APPROVED' }),
      );
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('1 internal notification'),
        'NotificationsService',
      );
    });

    it('warns and skips email when user has no email', async () => {
      userClient.getUsersByIds.mockResolvedValue(new Map());

      await service.dispatch({
        type: 'WORKFLOW_REJECTED',
        recipientUserIds: ['user-no-email'],
        message: 'Rechazado',
      });

      expect(emailService.sendNotification).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No email found'),
        'NotificationsService',
      );
    });

    it('logs warning when some email sends fail (Promise.allSettled)', async () => {
      const userId = 'user-uuid-2';
      userClient.getUsersByIds.mockResolvedValue(
        new Map([[userId, { id: userId, email: 'fail@test.com', fullName: 'Fail' }]]),
      );
      emailService.sendNotification.mockRejectedValue(new Error('SMTP error'));

      await service.dispatch({
        type: 'WORKFLOW_TASK_ASSIGNED',
        recipientUserIds: [userId],
        message: 'Tarea asignada',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send 1'),
        'NotificationsService',
      );
    });

    it('dispatches with workflowId, workflowTitle and metadata', async () => {
      userClient.getUsersByIds.mockResolvedValue(new Map());

      await service.dispatch({
        type: 'WORKFLOW_CLOSED',
        recipientUserIds: ['user-1'],
        message: 'Cerrado',
        workflowId: 'wf-1',
        workflowTitle: 'WF Title',
        metadata: { key: 'value' },
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1', workflowTitle: 'WF Title' }),
      );
    });

    it('uses provided orgName without calling orgClient', async () => {
      const orgClient = (service as any).orgClient;
      userClient.getUsersByIds.mockResolvedValue(new Map());

      await service.dispatch({
        type: 'WORKFLOW_APPROVED',
        recipientUserIds: ['user-1'],
        message: 'Aprobado',
        orgId: 'org-uuid',
        orgName: 'Proasistemas',
      });

      expect(orgClient.getOrgName).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgName: 'Proasistemas' }),
      );
    });

    it('calls orgClient.getOrgName when orgId present but orgName is absent', async () => {
      const orgClient = (service as any).orgClient;
      orgClient.getOrgName.mockResolvedValue('Proasistemas');
      userClient.getUsersByIds.mockResolvedValue(new Map());

      await service.dispatch({
        type: 'WORKFLOW_APPROVED',
        recipientUserIds: ['user-1'],
        message: 'Aprobado',
        orgId: 'org-uuid',
      });

      expect(orgClient.getOrgName).toHaveBeenCalledWith('org-uuid');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgName: 'Proasistemas' }),
      );
    });

    it('handles empty recipientUserIds without error', async () => {
      userClient.getUsersByIds.mockResolvedValue(new Map());

      await service.dispatch({ type: 'WORKFLOW_APPROVED', recipientUserIds: [], message: 'No recipients' });

      expect(repo.save).toHaveBeenCalledWith([]);
    });

    it('does not log failed-email warning when all succeed', async () => {
      const userId = 'user-ok';
      userClient.getUsersByIds.mockResolvedValue(
        new Map([[userId, { id: userId, email: 'ok@test.com', fullName: 'OK' }]]),
      );
      emailService.sendNotification.mockResolvedValue(undefined);

      await service.dispatch({ type: 'WORKFLOW_APPROVED', recipientUserIds: [userId], message: 'OK' });

      const warnCalls = (logger.warn as jest.Mock).mock.calls;
      const failedWarn = warnCalls.find(([msg]) => typeof msg === 'string' && msg.includes('Failed to send'));
      expect(failedWarn).toBeUndefined();
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns paginated notifications', async () => {
      const notif = buildNotification();
      qb.getManyAndCount.mockResolvedValue([[notif], 1]);
      repo.count.mockResolvedValue(1);

      const dto: ListNotificationsDto = { page: 1, limit: 20 };
      const result = await service.list('user-1', dto);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.unreadCount).toBe(1);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('applies andWhere when unreadOnly=true', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      repo.count.mockResolvedValue(0);

      const dto: ListNotificationsDto = { page: 2, limit: 10, unreadOnly: true };
      await service.list('user-1', dto);

      expect(qb.andWhere).toHaveBeenCalledWith('n.read = false');
      expect(qb.skip).toHaveBeenCalledWith(10); // (2-1)*10
    });

    it('skips andWhere when unreadOnly=false', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      repo.count.mockResolvedValue(0);

      await service.list('user-1', { page: 1, limit: 20, unreadOnly: false });

      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  // ─── markAsRead ───────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks unread notification as read and saves', async () => {
      const notif = buildNotification({ read: false });
      repo.findOne.mockResolvedValue(notif);
      repo.save.mockResolvedValue(notif);

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(repo.save).toHaveBeenCalled();
      expect(result.read).toBe(true);
    });

    it('does not re-save already-read notification', async () => {
      const notif = buildNotification({ read: true, readAt: new Date() });
      repo.findOne.mockResolvedValue(notif);

      await service.markAsRead('notif-1', 'user-1');

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when notification not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markAsRead('missing-id', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── markAllAsRead ────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('returns the number of affected rows', async () => {
      qb.execute.mockResolvedValue({ affected: 5 });

      const result = await service.markAllAsRead('user-1');

      expect(result).toEqual({ updated: 5 });
    });

    it('returns 0 when affected is undefined', async () => {
      qb.execute.mockResolvedValue({ affected: undefined });

      const result = await service.markAllAsRead('user-2');

      expect(result).toEqual({ updated: 0 });
    });
  });

  // ─── getUnreadCount ───────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns the count of unread notifications', async () => {
      repo.count.mockResolvedValue(7);

      const result = await service.getUnreadCount('user-1');

      expect(result).toEqual({ count: 7 });
      expect(repo.count).toHaveBeenCalledWith({ where: { userId: 'user-1', read: false } });
    });

    it('returns 0 when there are no unread notifications', async () => {
      repo.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('user-no-unreads');

      expect(result).toEqual({ count: 0 });
    });
  });
});
