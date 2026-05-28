import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SseTicketService } from './sse-ticket.service';

/**
 * Guards the SSE stream endpoint.
 * Validates the ephemeral ticket from the `?ticket=` query parameter against
 * Redis BEFORE NestJS sets SSE response headers and flushes the 200 OK.
 * This is the only reliable way to return 401 on an @Sse() route because
 * once the SSE headers are flushed the response status can no longer change.
 *
 * On success, writes `req.sseUserId` so the route handler can read it
 * without doing another Redis round-trip.
 */
@Injectable()
export class SseTicketGuard implements CanActivate {
  constructor(private readonly sseTicketService: SseTicketService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { sseUserId?: string }>();
    const ticket = req.query['ticket'] as string | undefined;

    if (!ticket) throw new UnauthorizedException('Missing SSE ticket');

    const userId = await this.sseTicketService.validate(ticket);
    if (!userId) throw new UnauthorizedException('Invalid or expired SSE ticket');

    req.sseUserId = userId;
    return true;
  }
}
