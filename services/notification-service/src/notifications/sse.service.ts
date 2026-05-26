import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Observable, fromEvent } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { IncomingMessage } from 'http';

@Injectable()
export class SseService implements OnModuleDestroy {
  /** userId → set of active SSE subjects */
  private readonly clients = new Map<string, Set<Subject<MessageEvent>>>();

  /**
   * Register a new SSE connection for a user.
   * Automatically removes the connection when the HTTP request closes.
   */
  connect(userId: string, req: IncomingMessage): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(subject);

    // RxJS observable that emits once when the client disconnects
    const close$ = fromEvent(req, 'close').pipe(take(1));

    // Clean up the subject and remove from the map on disconnect
    close$.subscribe(() => {
      this.removeClient(userId, subject);
    });

    // Send a ping immediately so the browser confirms the SSE handshake
    subject.next({ data: { type: 'connected' } });

    return subject.asObservable().pipe(takeUntil(close$));
  }

  /** Push an event to all active connections for a given user. */
  emit(userId: string, data: Record<string, unknown>, eventType = 'notification'): void {
    const subjects = this.clients.get(userId);
    if (!subjects?.size) return;
    const event: MessageEvent = { data, type: eventType };
    for (const subject of subjects) {
      subject.next(event);
    }
  }

  /** Returns the number of users with at least one active SSE connection. */
  get connectedUsers(): number {
    return this.clients.size;
  }

  private removeClient(userId: string, subject: Subject<MessageEvent>): void {
    const subjects = this.clients.get(userId);
    if (!subjects) return;
    subjects.delete(subject);
    if (!subject.closed) subject.complete();
    if (subjects.size === 0) this.clients.delete(userId);
  }

  onModuleDestroy(): void {
    for (const subjects of this.clients.values()) {
      for (const subject of subjects) {
        if (!subject.closed) subject.complete();
      }
    }
    this.clients.clear();
  }
}
