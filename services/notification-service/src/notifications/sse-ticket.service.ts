import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';

const TICKET_TTL_MS = 30_000;

interface TicketEntry {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class SseTicketService implements OnModuleDestroy {
  private readonly tickets = new Map<string, TicketEntry>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /** Issues a single-use ticket valid for 30 seconds. */
  create(userId: string): string {
    const ticket = randomUUID();
    this.tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
    return ticket;
  }

  /**
   * Validates and atomically consumes a ticket.
   * Returns the associated userId, or null if the ticket is unknown/expired.
   */
  consume(ticket: string): string | null {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    this.tickets.delete(ticket);
    if (Date.now() > entry.expiresAt) return null;
    return entry.userId;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.tickets.entries()) {
      if (now > entry.expiresAt) this.tickets.delete(key);
    }
  }
}
