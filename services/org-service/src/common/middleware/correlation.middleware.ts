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
    const incomingCorrelationId = Array.isArray(rawHeader)
      ? rawHeader[0]
      : rawHeader;
    const correlationId =
      typeof incomingCorrelationId === 'string' &&
      incomingCorrelationId.trim().length > 0
        ? incomingCorrelationId
        : randomUUID();

    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    correlationStorage.run({ correlationId }, () => next());
  }
}
