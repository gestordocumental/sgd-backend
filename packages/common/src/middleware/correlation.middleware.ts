import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { correlationStorage } from '../correlation/correlation.context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Kong injects x-correlation-id — fall back to a new UUID for direct calls
    const rawHeader = req.headers[CORRELATION_ID_HEADER];
    const incomingId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const normalized = typeof incomingId === 'string' ? incomingId.trim() : '';
    const correlationId =
      /^[A-Za-z0-9._:-]{1,128}$/.test(normalized)
        ? normalized
        : randomUUID();

    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const clientIp = rawIp
      ? rawIp.split(',')[0].trim()
      : (req.headers['x-real-ip'] as string | undefined) ?? req.ip ?? null;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    correlationStorage.run({ correlationId, clientIp: clientIp ?? null }, () => next());
  }
}
