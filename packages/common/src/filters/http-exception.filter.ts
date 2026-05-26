import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';

// UUID pattern — strips internal IDs from error messages in production.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IS_PROD = process.env['NODE_ENV'] === 'production';

function sanitize(value: unknown): unknown {
  if (!IS_PROD) return value;
  if (typeof value === 'string') return value.replace(UUID_RE, '[id]');
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]),
    );
  }
  return value;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody = isHttp ? exception.getResponse() : null;

    const errorBody =
      typeof rawBody === 'object' && rawBody !== null
        ? rawBody
        : { message: isHttp ? exception.message : 'Internal server error' };

    const sanitized = sanitize(errorBody) as Record<string, unknown>;

    const responseBody = {
      ...sanitized,
      statusCode: status,
      correlationId: getCorrelationId(),
      timestamp: new Date().toISOString(),
      path: req.path,
    };

    if (status >= 500) {
      Sentry.captureException(exception);
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.path}`,
        exception instanceof Error ? exception.stack : String(exception),
        'HttpExceptionFilter',
      );
    } else {
      this.logger.warn(`${req.method} ${req.path} → ${status}`, 'HttpExceptionFilter');
    }

    res.status(status).json(responseBody);
  }
}
