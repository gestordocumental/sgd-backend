import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';

export const TICKET_TTL_SECONDS = 30;

/**
 * Manages short-lived SSE authentication tickets stored in Redis.
 *
 * Design decisions:
 * - Stored in Redis (not in-memory) so tickets survive service restarts and
 *   work correctly across multiple instances in Railway.
 * - Tickets are NOT deleted on first use. They expire after TICKET_TTL_SECONDS.
 *   This allows EventSource's built-in auto-reconnect (which reuses the same URL)
 *   to succeed within the 30-second window, preventing the repeated 401 loop that
 *   occurred with one-time-use tickets.
 * - After 30 s the ticket expires and any auto-reconnect will get 401, at which
 *   point the frontend hook detects the error and fetches a fresh ticket.
 */
@Injectable()
export class SseTicketService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** Issues a ticket valid for TICKET_TTL_SECONDS seconds. */
  async create(userId: string): Promise<string> {
    const ticket = randomUUID();
    await this.redis.setex(`sse-ticket:${ticket}`, TICKET_TTL_SECONDS, userId);
    return ticket;
  }

  /**
   * Validates a ticket and returns the associated userId, or null if the ticket
   * is unknown or expired.  The ticket is NOT deleted so EventSource can
   * reconnect with the same URL within the TTL window.
   */
  async validate(ticket: string): Promise<string | null> {
    return this.redis.get(`sse-ticket:${ticket}`);
  }

  /** Explicitly revoke a ticket before it expires (e.g., on clean disconnect). */
  async revoke(ticket: string): Promise<void> {
    await this.redis.del(`sse-ticket:${ticket}`);
  }
}
