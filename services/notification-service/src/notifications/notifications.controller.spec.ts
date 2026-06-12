import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtPayload } from '@sgd/common';

function makeService(): jest.Mocked<NotificationsService> {
  return {
    list:           jest.fn(),
    getUnreadCount: jest.fn(),
    markAllAsRead:  jest.fn(),
    markAsRead:     jest.fn(),
  } as any;
}

const user: JwtPayload = { sub: 'user-1', email: 'user@test.com', isSuperAdmin: false };

describe('NotificationsController', () => {
  let ctrl:             NotificationsController;
  let service:          jest.Mocked<NotificationsService>;
  let sseService:       { connect: jest.Mock };
  let sseTicketService: { create: jest.Mock; validate: jest.Mock; revoke: jest.Mock };

  beforeEach(() => {
    service          = makeService();
    sseService       = { connect: jest.fn() };
    sseTicketService = { create: jest.fn(), validate: jest.fn(), revoke: jest.fn() };
    ctrl = new NotificationsController(service, sseService as any, sseTicketService as any);
  });

  // ─── issueTicket ────────────────────────────────────────────────────────────

  it('issueTicket() calls create with user.sub and returns ticket + expiresIn:30', async () => {
    sseTicketService.create.mockResolvedValue('ticket-uuid');
    await expect(ctrl.issueTicket(user)).resolves.toEqual({ ticket: 'ticket-uuid', expiresIn: 30 });
    expect(sseTicketService.create).toHaveBeenCalledWith('user-1');
  });

  // ─── stream ─────────────────────────────────────────────────────────────────
  // stream() is now synchronous — ticket validation is handled by SseTicketGuard
  // before the handler runs. The handler only reads req.sseUserId.

  it('stream() calls sseService.connect with req.sseUserId', () => {
    const observable = {} as any;
    const req        = { sseUserId: 'user-1' } as any;
    sseService.connect.mockReturnValue(observable);

    expect(ctrl.stream(req)).toBe(observable);
    expect(sseService.connect).toHaveBeenCalledWith('user-1', req);
  });

  // ─── list ───────────────────────────────────────────────────────────────────

  it('list() delegates to service.list with user.sub', async () => {
    const dto    = { page: 1, limit: 10 } as any;
    const result = { data: [], total: 0, page: 1, limit: 10 };
    service.list.mockResolvedValue(result as any);
    await expect(ctrl.list(user, dto)).resolves.toBe(result);
    expect(service.list).toHaveBeenCalledWith('user-1', dto);
  });

  it('unreadCount() delegates to service.getUnreadCount with user.sub', async () => {
    service.getUnreadCount.mockResolvedValue({ count: 3 });
    await expect(ctrl.unreadCount(user)).resolves.toEqual({ count: 3 });
    expect(service.getUnreadCount).toHaveBeenCalledWith('user-1');
  });

  it('markAllAsRead() delegates to service.markAllAsRead with user.sub', async () => {
    service.markAllAsRead.mockResolvedValue({ updated: 5 });
    await expect(ctrl.markAllAsRead(user)).resolves.toEqual({ updated: 5 });
    expect(service.markAllAsRead).toHaveBeenCalledWith('user-1');
  });

  it('markAsRead() delegates to service.markAsRead with id and user.sub', async () => {
    const notif = { id: 'notif-1', read: true } as any;
    service.markAsRead.mockResolvedValue(notif);
    await expect(ctrl.markAsRead('notif-1', user)).resolves.toBe(notif);
    expect(service.markAsRead).toHaveBeenCalledWith('notif-1', 'user-1');
  });
});
