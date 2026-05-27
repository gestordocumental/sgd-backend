import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { correlationStorage } from '../correlation/correlation.context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawHeader = req.headers[CORRELATION_ID_HEADER];
    const incomingCorrelationId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const normalized = typeof incomingCorrelationId === 'string' ? incomingCorrelationId.trim() : '';
    const correlationId =
      /^[A-Za-z0-9._:-]{1,128}$/.test(normalized)
        ? normalized
        : randomUUID();

    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    correlationStorage.run({ correlationId }, () => next());
  }
}
