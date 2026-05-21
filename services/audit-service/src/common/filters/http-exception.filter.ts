import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';

// UUID pattern — used to strip internal IDs from error messages in production.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IS_PROD = process.env['NODE_ENV'] === 'production';

/** Replaces UUID values in a string with '[id]' when running in production. */
function sanitize(value: unknown): unknown {
  if (IS_PROD && typeof value === 'string') return value.replace(UUID_RE, '[id]');
  if (IS_PROD && Array.isArray(value))      return value.map(sanitize);
  return value;
}

import * as Sentry from '@sentry/node';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx   = host.switchToHttp();
    const req   = ctx.getRequest<Request>();
    const res   = ctx.getResponse<Response>();

    const isHttp  = exception instanceof HttpException;
    const status  = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody = isHttp ? exception.getResponse() : null;

    // Preserve structured error bodies (e.g. ConflictException with details)
    const errorBody =
      typeof rawBody === 'object' && rawBody !== null
        ? rawBody
        : { message: isHttp ? exception.message : 'Internal server error' };

    // Sanitize internal IDs from outgoing messages in production
    const sanitized = IS_PROD && typeof errorBody === 'object' && errorBody !== null
      ? Object.fromEntries(
          Object.entries(errorBody as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]),
        )
      : errorBody;

    const responseBody = {
      ...sanitized,
      statusCode:    status,
      correlationId: getCorrelationId(),
      timestamp:     new Date().toISOString(),
      path:          req.url,
    };

    // Log as error only for 5xx — 4xx are expected business errors
    if (status >= 500) {
      Sentry.captureException(exception);
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
        'HttpExceptionFilter',
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.url} → ${status}`,
        'HttpExceptionFilter',
      );
    }

    res.status(status).json(responseBody);
  }
}
