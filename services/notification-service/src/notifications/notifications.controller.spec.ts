import { UnauthorizedException } from '@nestjs/common';
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
  let sseTicketService: { create: jest.Mock; consume: jest.Mock };

  beforeEach(() => {
    service          = makeService();
    sseService       = { connect: jest.fn() };
    sseTicketService = { create: jest.fn(), consume: jest.fn() };
    ctrl = new NotificationsController(service, sseService as any, sseTicketService as any);
  });

  // ─── issueTicket ────────────────────────────────────────────────────────────

  it('issueTicket() calls create with user.sub and returns ticket + expiresIn:30', () => {
    sseTicketService.create.mockReturnValue('ticket-uuid');
    expect(ctrl.issueTicket(user)).toEqual({ ticket: 'ticket-uuid', expiresIn: 30 });
    expect(sseTicketService.create).toHaveBeenCalledWith('user-1');
  });

  // ─── stream ─────────────────────────────────────────────────────────────────

  it('stream() connects when ticket is valid', () => {
    const req        = {} as any;
    const observable = {} as any;
    sseTicketService.consume.mockReturnValue('user-1');
    sseService.connect.mockReturnValue(observable);

    expect(ctrl.stream('valid-ticket', req)).toBe(observable);
    expect(sseTicketService.consume).toHaveBeenCalledWith('valid-ticket');
    expect(sseService.connect).toHaveBeenCalledWith('user-1', req);
  });

  it('stream() throws UnauthorizedException when ticket is invalid or expired', () => {
    sseTicketService.consume.mockReturnValue(null);
    expect(() => ctrl.stream('bad-ticket', {} as any)).toThrow(UnauthorizedException);
    expect(sseService.connect).not.toHaveBeenCalled();
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
