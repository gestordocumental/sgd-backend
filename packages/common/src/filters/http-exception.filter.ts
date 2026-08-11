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

// Postgres error code for "lock_not_available" — a SELECT ... FOR UPDATE/FOR
// SHARE that couldn't acquire its lock within lock_timeout (see org-service's
// app.module.ts, which sets one to fail fast instead of hanging forever under
// lock contention). Detected structurally instead of importing TypeORM's
// QueryFailedError class, since this package is shared by services that
// don't depend on TypeORM at all. Checks both shapes the error can arrive
// in: TypeORM's QueryFailedError wraps the raw driver error in
// `.driverError.code`, while node-postgres's own DatabaseError (surfaced
// directly by services that talk to `pg` without an ORM) exposes `.code` on
// the instance itself.
const PG_LOCK_TIMEOUT = '55P03';

function isPgLockTimeout(exception: unknown): boolean {
  const err = exception as { code?: string; driverError?: { code?: string } } | null | undefined;
  return err?.code === PG_LOCK_TIMEOUT || err?.driverError?.code === PG_LOCK_TIMEOUT;
}

/**
 * Sanitizes a value by replacing UUID substrings in strings with "[id]" when running in production.
 *
 * @param value - The input to sanitize; may be a primitive, an array, or a plain object
 * @returns The sanitized value where UUIDs inside strings are replaced by `"[id]"`; returns the original value unchanged when not in production
 */
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
    const isLockTimeout = !isHttp && isPgLockTimeout(exception);
    const status = isHttp
      ? exception.getStatus()
      : isLockTimeout
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody = isHttp ? exception.getResponse() : null;

    const errorBody =
      typeof rawBody === 'object' && rawBody !== null
        ? rawBody
        : isLockTimeout
          ? { message: 'Database is temporarily busy, please retry', errorCode: 'DB_LOCK_TIMEOUT' }
          : { message: isHttp ? exception.message : 'Internal server error' };

    const sanitized = sanitize(errorBody);
    const normalizedErrorBody = Array.isArray(sanitized)
      ? { message: sanitized }
      : typeof sanitized === 'object' && sanitized !== null
        ? (sanitized as Record<string, unknown>)
        : { message: String(sanitized) };

    const responseBody = {
      ...normalizedErrorBody,
      statusCode: status,
      correlationId: getCorrelationId(),
      timestamp: new Date().toISOString(),
      path: req.path,
    };

    // Lock timeouts are a designed fail-fast outcome (see isPgLockTimeout
    // above), not a bug — logged as a warning like 4xx business errors
    // rather than captured to Sentry as an unhandled exception.
    if (status >= 500 && !isLockTimeout) {
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
