import { EventEmitter } from 'events';
import { skip, take } from 'rxjs/operators';
import { SseService } from './sse.service';

const CHANNEL_PREFIX = 'sse:events:';

function makeReq(): EventEmitter {
  return new EventEmitter();
}

describe('SseService', () => {
  let service: SseService;
  let publisher: { publish: jest.Mock };
  let triggerRedis: (userId: string, data: Record<string, unknown>, eventType?: string) => void;
  let triggerRawRedis: (channel: string, message: string) => void;

  beforeEach(async () => {
    publisher = { publish: jest.fn().mockResolvedValue(1) };

    let pmessageHandler: (pattern: string, channel: string, message: string) => void;

    const subscriber = {
      psubscribe:   jest.fn().mockResolvedValue(undefined),
      punsubscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'pmessage') pmessageHandler = handler;
      }),
    };

    service = new SseService(publisher as any, subscriber as any);
    await service.onModuleInit();

    triggerRedis = (userId, data, eventType = 'notification') =>
      pmessageHandler(
        `${CHANNEL_PREFIX}*`,
        `${CHANNEL_PREFIX}${userId}`,
        JSON.stringify({ data, eventType }),
      );

    triggerRawRedis = (channel, message) =>
      pmessageHandler(`${CHANNEL_PREFIX}*`, channel, message);
  });

  it('registers a connection and emits events to the user', (done) => {
    const req = makeReq();
    const stream$ = service.connect('user-1', req as any);

    expect(service.connectedUsers).toBe(1);

    stream$.pipe(skip(1), take(1)).subscribe({
      next: (event) => {
        expect(event).toEqual({
          data: { notificationId: 'notif-1' },
          type: 'notification',
        });
        done();
      },
    });

    service.emit('user-1', { notificationId: 'notif-1' });
    triggerRedis('user-1', { notificationId: 'notif-1' });
  });

  it('supports custom event types', (done) => {
    const req = makeReq();
    const stream$ = service.connect('user-1', req as any);

    stream$.pipe(skip(1), take(1)).subscribe({
      next: (event) => {
        expect(event).toEqual({ data: { orgId: 'org-1' }, type: 'session-revoked' });
        done();
      },
    });

    service.emit('user-1', { orgId: 'org-1' }, 'session-revoked');
    triggerRedis('user-1', { orgId: 'org-1' }, 'session-revoked');
  });

  it('does nothing when emitting to a user without clients', () => {
    expect(() => {
      service.emit('missing-user', { ok: true });
      triggerRedis('missing-user', { ok: true });
    }).not.toThrow();
    expect(service.connectedUsers).toBe(0);
  });

  it('removes the client when the request closes', () => {
    const req = makeReq();
    const complete = jest.fn();
    service.connect('user-1', req as any).subscribe({ complete });

    req.emit('close');

    expect(service.connectedUsers).toBe(0);
    expect(complete).toHaveBeenCalled();
  });

  it('keeps other user connections when one user disconnects', () => {
    const req1 = makeReq();
    const req2 = makeReq();

    service.connect('user-1', req1 as any).subscribe();
    service.connect('user-2', req2 as any).subscribe();

    req1.emit('close');

    expect(service.connectedUsers).toBe(1);
  });

  it('completes all clients on module destroy', async () => {
    const req1 = makeReq();
    const req2 = makeReq();
    const complete1 = jest.fn();
    const complete2 = jest.fn();
    service.connect('user-1', req1 as any).subscribe({ complete: complete1 });
    service.connect('user-2', req2 as any).subscribe({ complete: complete2 });

    await service.onModuleDestroy();

    expect(service.connectedUsers).toBe(0);
    expect(complete1).toHaveBeenCalled();
    expect(complete2).toHaveBeenCalled();
  });

  it('publishes to the correct Redis channel on emit', () => {
    service.emit('user-42', { msg: 'hello' }, 'test-event');

    expect(publisher.publish).toHaveBeenCalledWith(
      'sse:events:user-42',
      JSON.stringify({ data: { msg: 'hello' }, eventType: 'test-event' }),
    );
  });

  it('delivers events from a different replica (cross-replica scenario)', (done) => {
    const req = makeReq();
    const stream$ = service.connect('user-1', req as any);

    stream$.pipe(skip(1), take(1)).subscribe({
      next: (event) => {
        expect(event.data).toEqual({ type: 'WORKFLOW_APPROVED', title: 'Aprobado' });
        done();
      },
    });

    // Simulate another replica publishing directly to Redis (bypass local emit)
    triggerRedis('user-1', { type: 'WORKFLOW_APPROVED', title: 'Aprobado' });
  });

  it('ignores malformed messages from Redis without throwing', (done) => {
    const req = makeReq();
    const next = jest.fn();
    service.connect('user-1', req as any).pipe(skip(1)).subscribe({ next });

    expect(() => triggerRawRedis('sse:events:user-1', 'not-valid-json')).not.toThrow();

    setTimeout(() => {
      expect(next).not.toHaveBeenCalled();
      done();
    }, 10);
  });
});
