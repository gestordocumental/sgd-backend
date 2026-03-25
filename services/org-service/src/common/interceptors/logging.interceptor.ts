import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const { method, path, ip } = req;
    const startedAt = Date.now();

    this.logger.http({
      type: 'request',
      method,
      path,
      ip,
      correlationId: getCorrelationId(),
      message: `→ ${method} ${path}`,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.http({
            type: 'response',
            method,
            path,
            statusCode: res.statusCode,
            duration: Date.now() - startedAt,
            correlationId: getCorrelationId(),
            message: `← ${method} ${path} ${res.statusCode} (${Date.now() - startedAt}ms)`,
          });
        },
        error: (err) => {
          const statusCode =
            typeof err?.getStatus === 'function'
              ? err.getStatus()
              : (err?.status ?? 500);

          this.logger.http({
            type: 'response',
            method,
            path,
            statusCode,
            duration: Date.now() - startedAt,
            correlationId: getCorrelationId(),
            message: `← ${method} ${path} ${statusCode} (${Date.now() - startedAt}ms)`,
          });
        },
      }),
    );
  }
}
