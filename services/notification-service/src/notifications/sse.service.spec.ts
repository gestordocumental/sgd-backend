import { EventEmitter } from 'events';
import { skip, take } from 'rxjs/operators';
import { SseService } from './sse.service';

function makeReq(): EventEmitter {
  return new EventEmitter();
}

describe('SseService', () => {
  let service: SseService;

  beforeEach(() => {
    service = new SseService();
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
  });

  it('does nothing when emitting to a user without clients', () => {
    expect(() => service.emit('missing-user', { ok: true })).not.toThrow();
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

  it('completes all clients on module destroy', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    const complete1 = jest.fn();
    const complete2 = jest.fn();
    service.connect('user-1', req1 as any).subscribe({ complete: complete1 });
    service.connect('user-2', req2 as any).subscribe({ complete: complete2 });

    service.onModuleDestroy();

    expect(service.connectedUsers).toBe(0);
    expect(complete1).toHaveBeenCalled();
    expect(complete2).toHaveBeenCalled();
  });
});
