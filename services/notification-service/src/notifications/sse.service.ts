import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ReplaySubject, Observable, fromEvent } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { IncomingMessage } from 'http';
import type Redis from 'ioredis';

const CHANNEL_PREFIX = 'sse:events:';

interface SsePayload {
  data: Record<string, unknown>;
  eventType: string;
}

/**
 * Manages SSE connections per user and broadcasts events across replicas via
 * Redis Pub/Sub.
 *
 * Flow:
 *   emit(userId, data) → publisher.publish("sse:events:{userId}", payload)
 *                      → Redis delivers to ALL replicas (including sender)
 *                      → pmessage handler checks local clients map
 *                      → pushes to subjects only if this replica has connections
 *
 * This means events always arrive even when the Kafka consumer fires on replica B
 * but the browser is connected to replica A.
 */
@Injectable()
export class SseService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, Set<ReplaySubject<MessageEvent>>>();

  constructor(
    @Inject('REDIS_CLIENT') private readonly publisher: Redis,
    @Inject('REDIS_PUBSUB_CLIENT') private readonly subscriber: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscriber.psubscribe(`${CHANNEL_PREFIX}*`);
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const userId = channel.slice(CHANNEL_PREFIX.length);
      const subjects = this.clients.get(userId);
      if (!subjects?.size) return;
      try {
        const { data, eventType } = JSON.parse(message) as SsePayload;
        const event: MessageEvent = { data, type: eventType };
        for (const subject of subjects) {
          subject.next(event);
        }
      } catch {
        // malformed message from Redis — skip silently
      }
    });
  }

  /**
   * Register a new SSE connection for a user.
   * Automatically removes the connection when the HTTP request closes.
   */
  connect(userId: string, req: IncomingMessage): Observable<MessageEvent> {
    const subject = new ReplaySubject<MessageEvent>(1);

    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(subject);

    const close$ = fromEvent(req, 'close').pipe(take(1));

    close$.subscribe(() => {
      this.removeClient(userId, subject);
    });

    subject.next({ data: { type: 'connected' } });

    return subject.asObservable().pipe(takeUntil(close$));
  }

  /**
   * Publish an event for a user to Redis.
   * All replicas receive it; each pushes to its own local subjects if any exist.
   */
  emit(userId: string, data: Record<string, unknown>, eventType = 'notification'): void {
    const payload: SsePayload = { data, eventType };
    this.publisher
      .publish(`${CHANNEL_PREFIX}${userId}`, JSON.stringify(payload))
      .catch(() => {}); // fire-and-forget; Redis errors don't break request flow
  }

  get connectedUsers(): number {
    return this.clients.size;
  }

  private removeClient(userId: string, subject: ReplaySubject<MessageEvent>): void {
    const subjects = this.clients.get(userId);
    if (!subjects) return;
    subjects.delete(subject);
    if (!subject.closed) subject.complete();
    if (subjects.size === 0) this.clients.delete(userId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.punsubscribe(`${CHANNEL_PREFIX}*`).catch(() => {});
    for (const subjects of this.clients.values()) {
      for (const subject of subjects) {
        if (!subject.closed) subject.complete();
      }
    }
    this.clients.clear();
  }
}
